import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

async function extractInWorker(task) {
  const { filePath, format } = task;

  if (format === 'PDF') {
    let parser = null;
    try {
      const buffer = fs.readFileSync(filePath);
      parser = new PDFParse(new Uint8Array(buffer));
      await parser.load();
      const textResult = await parser.getText();
      const totalPages = textResult.total || 1;
      const pages = Array.isArray(textResult.pages)
        ? textResult.pages.map(p => (p && typeof p.text === 'string') ? p.text.trim() : '')
        : [];
      const fullText = pages.join('\n\n').trim();

      return {
        format: 'PDF',
        totalPages,
        pages: pages.length > 0 ? pages : [fullText],
        fullText,
        isScanned: fullText.length === 0,
        isBlank: fullText.length === 0,
        note: fullText.length === 0 ? 'PDF không chứa văn bản số (có thể là file scan hoặc trang trắng).' : null
      };
    } catch (err) {
      throw new Error(`Lỗi đọc PDF: ${err.message}`);
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try { await parser.destroy(); } catch (e) {}
      }
    }
  }

  if (format === 'DOCX') {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const fullText = (result.value || '').trim();
      return {
        format: 'DOCX',
        totalPages: 1,
        pages: [fullText],
        fullText,
        isScanned: false,
        isBlank: fullText.length === 0
      };
    } catch (err) {
      throw new Error(`Lỗi đọc file Word DOCX: ${err.message}`);
    }
  }

  throw new Error(`Định dạng không được hỗ trợ: ${format}`);
}

async function main() {
  const rawTask = process.env.WORKER_TASK;
  if (!rawTask) {
    if (process.send) process.send({ ok: false, error: 'Thiếu WORKER_TASK env' });
    process.exit(1);
  }

  try {
    const task = JSON.parse(rawTask);
    const data = await extractInWorker(task);
    if (process.send) {
      process.send({ ok: true, data });
    }
    process.exit(0);
  } catch (err) {
    if (process.send) {
      process.send({ ok: false, error: err.message });
    }
    process.exit(1);
  }
}

main();


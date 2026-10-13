import { parentPort, workerData } from 'node:worker_threads';
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

      let isScanned = false;
      let isBlank = false;
      let note = null;

      if (fullText.length === 0) {
        // Inspect all pages (up to 10 pages) to accurately distinguish blank vs scanned images vs vector graphics
        let totalOpsCount = 0;
        let imageOpsCount = 0;

        try {
          if (parser.doc && typeof parser.doc.getPage === 'function') {
            const pagesToCheck = Math.min(totalPages, 10);
            for (let p = 1; p <= pagesToCheck; p++) {
              try {
                const page = await parser.doc.getPage(p);
                const ops = await page.getOperatorList();
                if (ops && Array.isArray(ops.fnArray)) {
                  totalOpsCount += ops.fnArray.length;
                  for (const fn of ops.fnArray) {
                    // PDF.js OPS: 85 = paintImageXObject, 86 = paintInlineImageXObject, 87 = paintInlineImageXObjectGroup
                    if (fn === 85 || fn === 86 || fn === 87) {
                      imageOpsCount++;
                    }
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        if (totalOpsCount === 0) {
          // No operators anywhere: completely blank PDF
          isBlank = true;
          isScanned = false;
          note = 'Tài liệu PDF là trang trắng hoặc không có nội dung văn bản.';
        } else if (imageOpsCount > 0) {
          // Explicit evidence of image/scanned bitmaps
          isScanned = true;
          isBlank = false;
          note = 'Tài liệu là PDF dạng scan hoặc chứa hình ảnh, không trích xuất được văn bản số (cần OCR).';
        } else {
          // Has drawing operators (e.g. vector shapes, lines, tables), but not proven scanned images
          isScanned = false;
          isBlank = false;
          note = 'Không trích xuất được văn bản, có thể cần OCR.';
        }
      }

      return {
        format: 'PDF',
        totalPages,
        pages: pages.length > 0 ? pages : [fullText],
        fullText,
        isScanned,
        isBlank,
        note
      };
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('password') || msg.includes('encrypted') || err.name === 'PasswordException') {
        const error = new Error('Tài liệu PDF có mật khẩu bảo vệ, vui lòng gỡ mật khẩu trước khi tải lên.');
        error.code = 'PASSWORD_PROTECTED';
        throw error;
      }
      const error = new Error(`Không thể đọc tài liệu PDF: ${err.message || 'File lỗi hoặc không đúng định dạng'}`);
      error.code = 'PDF_CORRUPT';
      throw error;
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch (e) {}
      }
    }
  }

  if (format === 'DOCX') {
    try {
      // mammoth.convertToMarkdown retains paragraphs and markdown tables
      let result = await mammoth.convertToMarkdown({ path: filePath });
      let fullText = (result.value || '').trim();

      if (!fullText) {
        // fallback to raw text extraction
        const rawResult = await mammoth.extractRawText({ path: filePath });
        fullText = (rawResult.value || '').trim();
      }

      if (!fullText) {
        return {
          format: 'DOCX',
          totalPages: 1,
          pages: ['[Tài liệu DOCX không chứa nội dung văn bản]'],
          fullText: '[Tài liệu DOCX không chứa nội dung văn bản]',
          note: 'Tài liệu không có nội dung văn bản hoặc chỉ chứa bảng tính/hình vẽ chưa hỗ trợ.'
        };
      }

      return {
        format: 'DOCX',
        totalPages: 1,
        pages: [fullText],
        fullText,
        note: 'Hỗ trợ văn bản đoạn, danh sách và bảng biểu dạng Markdown. Không hỗ trợ hình vẽ vector phức tạp, macro hoặc SmartArt.'
      };
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('encrypted') || msg.includes('password')) {
        const error = new Error('Tài liệu Word có mật khẩu bảo vệ, vui lòng gỡ mật khẩu trước khi tải lên.');
        error.code = 'PASSWORD_PROTECTED';
        throw error;
      }
      const error = new Error(`Không thể đọc tài liệu Word (DOCX): ${err.message || 'File lỗi hoặc không đúng định dạng'}`);
      error.code = 'DOCX_CORRUPT';
      throw error;
    }
  }

  throw new Error(`Định dạng không được hỗ trợ trong worker: ${format}`);
}

function sendIpcAndExit(payload, exitCode = 0) {
  if (typeof process.send === 'function') {
    // Wait for message to be completely flushed across IPC pipe before terminating process
    const timer = setTimeout(() => {
      process.exit(exitCode);
    }, 3000);
    timer.unref();

    process.send(payload, undefined, undefined, (err) => {
      clearTimeout(timer);
      process.exit(exitCode);
    });
  } else {
    process.exit(exitCode);
  }
}

// Support execution as child_process.fork
if (typeof process.send === 'function') {
  const task = process.env.WORKER_TASK ? JSON.parse(process.env.WORKER_TASK) : null;
  if (task) {
    extractInWorker(task)
      .then(data => {
        sendIpcAndExit({ ok: true, data }, 0);
      })
      .catch(err => {
        sendIpcAndExit({ ok: false, error: err.message, code: err.code || 'EXTRACTION_ERROR' }, 0);
      });
  }
} else if (parentPort && workerData) {
  extractInWorker(workerData)
    .then(data => {
      parentPort.postMessage({ ok: true, data });
      process.exit(0);
    })
    .catch(err => {
      parentPort.postMessage({ ok: false, error: err.message, code: err.code || 'EXTRACTION_ERROR' });
      process.exit(0);
    });
}

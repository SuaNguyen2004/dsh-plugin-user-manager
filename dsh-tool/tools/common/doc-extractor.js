// dsh-tool/tools/common/doc-extractor.js
// Shared document text extractor (.pdf, .docx, .txt, .md, .csv) running inside dsh-tool

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mammoth from 'mammoth';

export const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20MB
export const DEFAULT_LIMIT = 8000;

export async function extractDocumentText(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Không tìm thấy tệp tài liệu: ${filePath}`);
  }
  const st = fs.statSync(filePath);
  if (!st.isFile()) {
    throw new Error(`Đường dẫn không phải là tệp hợp lệ: ${filePath}`);
  }
  if (st.size > MAX_DOC_BYTES) {
    throw new Error(`Dung lượng tệp vượt quá giới hạn 20MB.`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let fullText = '';
  let totalPages = 1;
  let format = ext.replace('.', '').toUpperCase() || 'TXT';

  if (ext === '.docx') {
    const res = await mammoth.extractRawText({ path: filePath });
    fullText = (res.value || '').trim();
  } else if (ext === '.pdf') {
    try {
      // Prefer poppler pdftotext for fast & accurate extraction in container
      const out = execFileSync('pdftotext', [filePath, '-'], {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024
      });
      fullText = out.trim();
      const pageSplits = out.split('\f');
      totalPages = Math.max(1, pageSplits.length - 1);
      if (typeof options.page === 'number' && options.page >= 1 && options.page <= pageSplits.length) {
        fullText = (pageSplits[options.page - 1] || '').trim();
      }
    } catch {
      const pdfParse = (await import('pdf-parse')).default;
      const dataBuffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(dataBuffer);
      fullText = (parsed.text || '').trim();
      totalPages = parsed.numpages || 1;
    }
  } else {
    fullText = fs.readFileSync(filePath, 'utf8');
  }

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(12000, Math.max(1, Number(options.limit) || DEFAULT_LIMIT));
  const slice = fullText.slice(offset, offset + limit);
  const hasMore = offset + limit < fullText.length;

  return {
    file_path: filePath,
    format,
    total_pages: totalPages,
    total_characters: fullText.length,
    offset,
    limit: slice.length,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    content: slice
  };
}

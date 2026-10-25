import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const EXTRACTION_TIMEOUT_MS = 15000; // 15 seconds
export const DEFAULT_CHUNK_CHARS = 8000;
export const MAX_CHUNK_LIMIT = 12000;

export class DocumentExtractionError extends Error {
  constructor(message, code = 'EXTRACTION_ERROR') {
    super(message);
    this.name = 'DocumentExtractionError';
    this.code = code;
  }
}

export function runInWorkerWithTimeout(task, timeoutMs = EXTRACTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./document-worker.js', import.meta.url));
    const proc = fork(workerPath, [], {
      env: {
        ...process.env,
        WORKER_TASK: JSON.stringify(task)
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });

    let timer = null;
    let settled = false;
    let resultMsg = null;

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new DocumentExtractionError(
        `Thời gian xử lý tài liệu ${task.format} vượt quá giới hạn 15 giây.`,
        'TIMEOUT'
      ));
    }, timeoutMs);

    proc.on('message', (msg) => { resultMsg = msg; });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGKILL'); } catch (e) {}
      reject(new DocumentExtractionError(`Lỗi tiến trình trích xuất: ${err.message}`, 'WORKER_ERROR'));
    });

    proc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (resultMsg) {
        if (resultMsg.ok) {
          resolve(resultMsg.data);
        } else {
          reject(new DocumentExtractionError(resultMsg.error || 'Lỗi xử lý tài liệu', resultMsg.code || 'EXTRACTION_ERROR'));
        }
      } else {
        reject(new DocumentExtractionError(`Tiến trình trích xuất dừng đột ngột với mã ${code}.`, 'WORKER_EXIT'));
      }
    });
  });
}

async function extractTxt(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new DocumentExtractionError(`Dung lượng file (${(stat.size / 1024 / 1024).toFixed(1)}MB) vượt quá 20MB`, 'FILE_TOO_LARGE');
  }
  const buffer = fs.readFileSync(filePath);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  try {
    text = decoder.decode(buffer);
  } catch (err) {
    throw new DocumentExtractionError('File văn bản không phải định dạng UTF-8 hợp lệ.', 'INVALID_ENCODING');
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return { format: 'TXT', totalPages: 1, pages: [text], fullText: text };
}

export async function extractDocument(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') throw new DocumentExtractionError('Đường dẫn file không hợp lệ.', 'INVALID_PARAM');
  if (!fs.existsSync(filePath)) throw new DocumentExtractionError(`File không tồn tại: ${filePath}`, 'NOT_FOUND');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new DocumentExtractionError('Đường dẫn trích xuất phải là file thông thường.', 'NOT_A_FILE');
  if (stat.size > MAX_FILE_SIZE_BYTES) throw new DocumentExtractionError('Dung lượng file vượt quá 20MB.', 'FILE_TOO_LARGE');

  const { page, offset, limit } = options;
  const ext = path.extname(filePath).toLowerCase();
  let extracted;

  switch (ext) {
    case '.pdf':
      extracted = await runInWorkerWithTimeout({ filePath, format: 'PDF' });
      break;
    case '.docx':
      extracted = await runInWorkerWithTimeout({ filePath, format: 'DOCX' });
      break;
    case '.txt':
      extracted = await extractTxt(filePath);
      break;
    default:
      throw new DocumentExtractionError(`Định dạng "${ext}" chưa được hỗ trợ (.pdf, .docx, .txt).`, 'UNSUPPORTED_FORMAT');
  }

  if (extracted.isScanned || extracted.isBlank || !extracted.fullText || extracted.fullText.length === 0) {
    return {
      filePath,
      format: extracted.format,
      totalPages: extracted.totalPages,
      totalCharacters: 0,
      content: '',
      hasMore: false,
      note: extracted.note || 'Tài liệu không có nội dung văn bản để trích xuất.'
    };
  }

  if (typeof page === 'number') {
    if (page > extracted.totalPages) throw new DocumentExtractionError(`Trang ${page} vượt quá tổng số trang (${extracted.totalPages}).`, 'PAGE_OUT_OF_RANGE');
    const pageIndex = page - 1;
    const pageText = extracted.pages[pageIndex] || '';
    const totalChars = pageText.length;
    const requestedLimit = typeof limit === 'number' ? Math.min(limit, MAX_CHUNK_LIMIT) : MAX_CHUNK_LIMIT;
    const pageStart = typeof offset === 'number' ? offset : 0;
    const pageEnd = Math.min(totalChars, pageStart + requestedLimit);
    const chunk = pageText.slice(pageStart, pageEnd);
    const hasMore = pageEnd < totalChars;

    return {
      filePath,
      format: extracted.format,
      totalPages: extracted.totalPages,
      page,
      totalCharacters: totalChars,
      offset: pageStart,
      limit: pageEnd - pageStart,
      hasMore,
      content: chunk,
      note: extracted.note || undefined,
      ...(hasMore ? { nextOffset: pageEnd } : {})
    };
  }

  const fullText = extracted.fullText || '';
  const totalLength = fullText.length;
  const start = Math.max(0, typeof offset === 'number' ? offset : 0);
  const requestedLimit = typeof limit === 'number' ? Math.min(limit, MAX_CHUNK_LIMIT) : DEFAULT_CHUNK_CHARS;
  const end = Math.min(totalLength, start + requestedLimit);
  const chunk = fullText.slice(start, end);
  const hasMore = end < totalLength;

  return {
    filePath,
    format: extracted.format,
    totalPages: extracted.totalPages,
    totalCharacters: totalLength,
    offset: start,
    limit: end - start,
    hasMore,
    content: chunk,
    note: extracted.note || undefined,
    ...(hasMore ? { nextOffset: end } : {})
  };
}


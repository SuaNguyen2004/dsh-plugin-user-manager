import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { extractDocument, DocumentExtractionError } from './document-extractor.js';

let defineToolCached = null;

export async function getDefineTool() {
  if (defineToolCached) return defineToolCached;
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    defineToolCached = mod.defineTool;
    return defineToolCached;
  } catch (e) {
    const candidatePaths = [
      '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
      '/usr/lib/node_modules/@deepseek-ai/dsh/package.json'
    ];
    for (const dshPkg of candidatePaths) {
      try {
        if (fs.existsSync(dshPkg)) {
          const req = createRequire(dshPkg);
          const dshToolsPath = req.resolve('@deepseek-ai/dsh-tools');
          const mod = await import(pathToFileURL(dshToolsPath).href);
          defineToolCached = mod.defineTool;
          return defineToolCached;
        }
      } catch (_) {}
    }
    throw e;
  }
}

function formatReadDocumentOutput(val) {
  const parts = [];
  parts.push(`=== TÀI LIỆU: ${val.file_path} ===`);
  parts.push(`Định dạng: ${val.format} | Tổng trang: ${val.total_pages || 1} | Tổng ký tự: ${val.total_characters}`);
  if (typeof val.page === 'number') {
    parts.push(`Đang xem trang: ${val.page}/${val.total_pages}`);
  } else {
    parts.push(`Phạm vi ký tự: ${val.offset} -> ${val.offset + val.limit} / ${val.total_characters}`);
  }
  if (val.has_more) {
    parts.push(`[GHI CHÚ]: Tài liệu còn nội dung. Để đọc tiếp, gọi lại read_document với offset=${val.next_offset || (val.offset + val.limit)}.`);
  }
  if (val.note) {
    parts.push(`[LƯU Ý]: ${val.note}`);
  }
  parts.push('--- NỘI DUNG ---');
  parts.push(val.content || '(Không có nội dung văn bản)');
  return parts.join('\n');
}

export async function createReadDocumentTool(options = {}) {
  const defineTool = await getDefineTool();
  const workspaceRoot = options.workspaceRoot || process.env.USER_WORKSPACE_DIR || '/data/workspace';

  return defineTool({
    name: 'read_document',
    description: 'Trích xuất và đọc nội dung văn bản từ các tệp tài liệu PDF (.pdf), Word (.docx) và tệp văn bản thuần (.txt) trong không gian làm việc.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Đường dẫn tuyệt đối hoặc tương đối tới tệp tài liệu cần đọc (.pdf, .docx, .txt).'
        },
        page: {
          type: 'integer',
          description: 'Số trang cần đọc (chỉ áp dụng cho file PDF, bắt đầu từ trang 1).'
        },
        offset: {
          type: 'integer',
          description: 'Vị trí ký tự bắt đầu đọc để đọc tiếp các tài liệu dài (mặc định: 0).'
        },
        limit: {
          type: 'integer',
          description: 'Số lượng ký tự tối đa cần đọc (mặc định 8000, tối đa 12000 ký tự).'
        }
      },
      required: ['file_path']
    },
    execute: async (args) => {
      const { file_path: reqPath, page, offset, limit } = args;
      const targetPath = path.isAbsolute(reqPath) ? reqPath : path.resolve(workspaceRoot, reqPath);

      try {
        const result = await extractDocument(targetPath, { page, offset, limit });
        return {
          content: [{
            type: 'text',
            text: formatReadDocumentOutput({
              file_path: reqPath,
              format: result.format,
              total_pages: result.totalPages,
              page: result.page,
              total_characters: result.totalCharacters,
              offset: result.offset,
              limit: result.limit,
              has_more: result.hasMore,
              next_offset: result.nextOffset,
              note: result.note,
              content: result.content
            })
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `[LỖI ĐỌC TÀI LIỆU]: ${err.message}`
          }],
          isError: true
        };
      }
    }
  });
}


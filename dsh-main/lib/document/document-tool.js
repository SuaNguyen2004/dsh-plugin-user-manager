import fs from 'node:fs';
import path from 'node:path';
import { extractDocument } from './document-extractor.js';

let defineToolCached = null;

export async function getDefineTool() {
  if (defineToolCached) return defineToolCached;
  const directPath = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
  if (fs.existsSync(directPath)) {
    const mod = await import(directPath);
    defineToolCached = mod.defineTool;
    return defineToolCached;
  }
  const mod = await import('@deepseek-ai/dsh-tools');
  defineToolCached = mod.defineTool;
  return defineToolCached;
}

export function findDocumentPath(reqPath, workspaceRoot = '/data/workspace') {
  if (!reqPath || typeof reqPath !== 'string') return null;

  // 1. Exact path or relative to workspace
  if (path.isAbsolute(reqPath) && fs.existsSync(reqPath)) return reqPath;
  const inWs = path.resolve(workspaceRoot, reqPath);
  if (fs.existsSync(inWs)) return inWs;

  const filename = path.basename(reqPath);

  // 1.1 Search inside workspace **/files/*/<filename>
  try {
    if (fs.existsSync(workspaceRoot)) {
      function searchFiles(dir, depth = 0) {
        if (depth > 4) return null;
        for (const item of fs.readdirSync(dir)) {
          const full = path.join(dir, item);
          try {
            const st = fs.statSync(full);
            if (st.isDirectory()) {
              if (item === 'files') {
                for (const cat of fs.readdirSync(full)) {
                  const target = path.join(full, cat, filename);
                  if (fs.existsSync(target)) return target;
                }
              } else {
                const found = searchFiles(full, depth + 1);
                if (found) return found;
              }
            }
          } catch {}
        }
        return null;
      }
      const found = searchFiles(workspaceRoot);
      if (found) return found;
    }
  } catch {}

  // 2. Search attachments directory of current container: DSH_HOME/attachments/v1/files/*/*/<filename>
  const dshHome = process.env.DSH_HOME || '/data/dsh_home';
  const attachmentsDir = path.join(dshHome, 'attachments', 'v1', 'files');
  if (fs.existsSync(attachmentsDir)) {
    try {
      const prefixes = fs.readdirSync(attachmentsDir);
      for (const prefix of prefixes) {
        const pDir = path.join(attachmentsDir, prefix);
        if (!fs.statSync(pDir).isDirectory()) continue;
        for (const hash of fs.readdirSync(pDir)) {
          const hDir = path.join(pDir, hash);
          const target = path.join(hDir, filename);
          if (fs.existsSync(target)) return target;
        }
      }
    } catch {}
  }

  // 3. Search /data/all_dsh_homes_ro/*/attachments/v1/files (for Admin viewing other users' files)
  const allHomesRo = '/data/all_dsh_homes_ro';
  if (fs.existsSync(allHomesRo)) {
    try {
      for (const uHome of fs.readdirSync(allHomesRo)) {
        const uAttach = path.join(allHomesRo, uHome, 'attachments', 'v1', 'files');
        if (fs.existsSync(uAttach)) {
          for (const prefix of fs.readdirSync(uAttach)) {
            const pDir = path.join(uAttach, prefix);
            if (!fs.statSync(pDir).isDirectory()) continue;
            for (const hash of fs.readdirSync(pDir)) {
              const target = path.join(pDir, hash, filename);
              if (fs.existsSync(target)) return target;
            }
          }
        }
      }
    } catch {}
  }

  // 4. Search in RO user workspaces: /data/all_users_ro/*
  const allUsersRo = '/data/all_users_ro';
  if (fs.existsSync(allUsersRo)) {
    try {
      for (const uDir of fs.readdirSync(allUsersRo)) {
        const target = path.join(allUsersRo, uDir, filename);
        if (fs.existsSync(target)) return target;
      }
    } catch {}
  }

  // 5. Search in /data/temp
  const tempTarget = path.join('/data/temp', filename);
  if (fs.existsSync(tempTarget)) return tempTarget;

  return inWs;
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
    description: 'Trích xuất và đọc nội dung văn bản từ các tệp tài liệu Word (.docx), PDF (.pdf) và văn bản thuần (.txt) được người dùng đính kèm hoặc có trong không gian làm việc.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Tên tệp hoặc đường dẫn tới tệp tài liệu cần đọc (.docx, .pdf, .txt).'
      },
      page: {
        type: 'integer',
        description: 'Số trang cần đọc (chỉ áp dụng cho file PDF, bắt đầu từ 1).'
      },
      offset: {
        type: 'integer',
        description: 'Vị trí ký tự bắt đầu đọc để đọc tiếp tài liệu dài (mặc định: 0).'
      },
      limit: {
        type: 'integer',
        description: 'Số lượng ký tự tối đa cần đọc (mặc định 8000).'
      }
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{
        type: 'text',
        text: typeof value === 'string' ? value : String(value)
      }]
    },
    execute: async (args) => {
      const { file_path: reqPath, page, offset, limit } = args;
      const targetPath = findDocumentPath(reqPath, workspaceRoot);

      if (!targetPath || !fs.existsSync(targetPath)) {
        return `[LỖI]: Không tìm thấy tệp tài liệu "${reqPath}" trong không gian làm việc hoặc thư mục đính kèm.`;
      }

      try {
        const result = await extractDocument(targetPath, { page, offset, limit });
        return formatReadDocumentOutput({
          file_path: reqPath,
          format: result.format,
          total_pages: result.totalPages,
          page: result.page,
          total_characters: result.totalCharacters,
          offset: result.offset,
          limit: result.limit,
          has_more: result.hasMore,
          next_offset: result.nextOffset,
          content: result.content,
          note: result.note
        });
      } catch (err) {
        return `[LỖI ĐỌC TÀI LIỆU]: ${err.message}`;
      }
    }
  });
}

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { extractDocument, DocumentExtractionError } from './document-extractor.js';
import { checkDocumentAccess, getOwnerOfSession } from './workspace.js';

let defineToolCached = null;

/**
 * Robustly load defineTool from @deepseek-ai/dsh-tools
 */
export async function getDefineTool() {
  if (defineToolCached) return defineToolCached;
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    defineToolCached = mod.defineTool;
    return defineToolCached;
  } catch (e) {
    const appData = process.env.APPDATA || 'C:\\Users\\Admin\\AppData\\Roaming';
    const dshPkg = path.join(appData, 'npm/node_modules/@deepseek-ai/dsh/package.json');
    const req = createRequire(dshPkg);
    const dshToolsPath = req.resolve('@deepseek-ai/dsh-tools');
    const mod = await import(pathToFileURL(dshToolsPath).href);
    defineToolCached = mod.defineTool;
    return defineToolCached;
  }
}

/**
 * Format document output into user/model readable text block
 */
function formatReadDocumentOutput(val) {
  const parts = [];
  parts.push(`=== TÀI LIỆU: ${val.file_path} ===`);
  parts.push(`Định dạng: ${val.format} | Tổng trang: ${val.total_pages || 1} | Tổng ký tự: ${val.total_characters}`);
  if (typeof val.page === 'number') {
    parts.push(`Đang xem trang: ${val.page}/${val.total_pages}`);
  } else {
    parts.push(`Đoạn ký tự: [${val.offset} -> ${val.offset + val.limit}]${val.has_more ? ' (Chưa hết)' : ' (Hết file)'}`);
  }

  if (val.note) {
    parts.push(`\n[LƯU Ý: ${val.note}]`);
  }

  if (val.content) {
    parts.push('\n--- NỘI DUNG ---');
    parts.push(val.content);
    parts.push('--- KẾT THÚC ĐOẠN ---');
  }

  if (val.has_more) {
    parts.push(`\n[Gợi ý: Tài liệu còn nội dung tiếp theo. Để đọc tiếp, gọi read_document với offset=${val.next_offset}]`);
  }

  return parts.join('\n');
}

/**
 * Execute document reading logic with strict isolation
 */
export async function executeReadDocument(args, exec) {
  if (!args || !args.file_path) {
    throw new Error('Tham số "file_path" là bắt buộc khi gọi read_document.');
  }

  // Determine user from trusted execution session
  const sessionId = exec?.sessionId || exec?.agent?.session?.id || exec?.agent?.id;
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Không thể xác định phiên làm việc (session) từ ngữ cảnh thực thi.');
  }

  const username = getOwnerOfSession(sessionId);
  if (!username) {
    throw new Error(`Truy cập bị từ chối: Phiên làm việc "${sessionId}" chưa được gán chủ sở hữu hợp lệ.`);
  }

  // Security check: verify ownership of attachment or workspace file
  const verifiedPath = checkDocumentAccess(username, args.file_path, sessionId);

  // Parse & extract document
  const extracted = await extractDocument(verifiedPath, {
    page: args.page,
    offset: args.offset,
    limit: args.limit
  });

  return {
    file_path: args.file_path,
    format: extracted.format || 'unknown',
    total_pages: typeof extracted.totalPages === 'number' ? extracted.totalPages : 1,
    page: typeof extracted.page === 'number' ? extracted.page : null,
    total_characters: typeof extracted.totalCharacters === 'number' ? extracted.totalCharacters : 0,
    offset: typeof extracted.offset === 'number' ? extracted.offset : 0,
    limit: typeof extracted.limit === 'number' ? extracted.limit : 0,
    has_more: !!extracted.hasMore,
    next_offset: typeof extracted.nextOffset === 'number' ? extracted.nextOffset : null,
    content: extracted.content || '',
    note: typeof extracted.note === 'string' && extracted.note.length > 0 ? extracted.note : null
  };
}

/**
 * Create and return defineTool instance for read_document
 */
export async function createReadDocumentTool() {
  const defineTool = await getDefineTool();

  return defineTool({
    name: 'read_document',
    description: 'Trích xuất và đọc nội dung văn bản từ tài liệu PDF (có text layer), Word (.docx) hoặc file văn bản UTF-8 (.txt). Hỗ trợ đọc tài liệu đính kèm (attachments) hoặc file trong workspace. Hỗ trợ đọc theo từng trang hoặc theo phân đoạn ký tự (offset/limit) cho tài liệu dài.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Đường dẫn file cần đọc (đường dẫn đính kèm từ hệ thống hoặc đường dẫn trong workspace).'
      },
      page: {
        type: 'number',
        description: 'Số trang cần đọc đối với PDF (bắt đầu từ trang 1).'
      },
      offset: {
        type: 'number',
        description: 'Vị trí ký tự bắt đầu đọc đối với tài liệu dài (bắt đầu từ 0).'
      },
      limit: {
        type: 'number',
        description: 'Số ký tự tối đa trả về trong một lần đọc (mặc định 8000 ký tự).'
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file_path: { type: 'string' },
          format: { type: 'string' },
          total_pages: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          page: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          total_characters: { type: 'number' },
          offset: { type: 'number' },
          limit: { type: 'number' },
          has_more: { type: 'boolean' },
          next_offset: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          content: { type: 'string' },
          note: { oneOf: [{ type: 'string' }, { type: 'null' }] }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatReadDocumentOutput(value)
      }]
    },
    async execute(args, exec) {
      return executeReadDocument(args, exec);
    }
  });
}

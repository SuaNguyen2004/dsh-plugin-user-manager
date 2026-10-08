import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const EXTRACTION_TIMEOUT_MS = 10000; // 10 seconds
export const DEFAULT_CHUNK_CHARS = 8000; // 8000 characters per chunk

/**
 * Custom Error class for document extraction errors
 */
export class DocumentExtractionError extends Error {
    constructor(message, code = "EXTRACTION_ERROR") {
        super(message);
        this.name = "DocumentExtractionError";
        this.code = code;
    }
}

/**
 * Execute a promise with a strict timeout
 */
function withTimeout(promise, timeoutMs, errorMessage) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new DocumentExtractionError(errorMessage, "TIMEOUT"));
            }, timeoutMs);
        }),
    ]);
}

/**
 * Extract text from UTF-8 text file (.txt)
 */
async function extractTxt(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
        throw new DocumentExtractionError(
            `Dung lượng file (${(stat.size / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn cho phép (tối đa 20MB)`,
            "FILE_TOO_LARGE",
        );
    }

    const buffer = fs.readFileSync(filePath);

    // Check for binary null bytes
    for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
        if (buffer[i] === 0) {
            throw new DocumentExtractionError(
                "File văn bản chứa dữ liệu nhị phân không phải định dạng UTF-8 hợp lệ",
                "INVALID_ENCODING",
            );
        }
    }

    let text = buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1); // Strip UTF-8 BOM
    }

    return {
        format: "TXT",
        totalPages: 1,
        pages: [text],
        fullText: text,
    };
}

/**
 * Extract text from Word document (.docx)
 */
async function extractDocx(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
        throw new DocumentExtractionError(
            `Dung lượng file (${(stat.size / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn cho phép (tối đa 20MB)`,
            "FILE_TOO_LARGE",
        );
    }

    try {
        const extraction = mammoth.extractRawText({ path: filePath });
        const result = await withTimeout(
            extraction,
            EXTRACTION_TIMEOUT_MS,
            "Thời gian xử lý tài liệu Word (DOCX) vượt quá giới hạn 10 giây",
        );

        const fullText = (result.value || "").trim();
        if (!fullText) {
            return {
                format: "DOCX",
                totalPages: 1,
                pages: ["[Tài liệu DOCX không chứa nội dung văn bản]"],
                fullText: "[Tài liệu DOCX không chứa nội dung văn bản]",
                note: "Tài liệu không có nội dung văn bản hoặc chỉ chứa bảng tính/hình vẽ chưa hỗ trợ.",
            };
        }

        return {
            format: "DOCX",
            totalPages: 1,
            pages: [fullText],
            fullText,
        };
    } catch (err) {
        if (err instanceof DocumentExtractionError) throw err;
        const msg = err.message || "";
        if (msg.includes("encrypted") || msg.includes("password")) {
            throw new DocumentExtractionError(
                "Tài liệu Word có mật khẩu bảo vệ, vui lòng gỡ mật khẩu trước khi tải lên.",
                "PASSWORD_PROTECTED",
            );
        }
        throw new DocumentExtractionError(
            `Không thể đọc tài liệu Word (DOCX): ${msg || "File lỗi hoặc không đúng định dạng"}`,
            "DOCX_CORRUPT",
        );
    }
}

/**
 * Extract text from PDF document (.pdf)
 */
async function extractPdf(filePath) {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
        throw new DocumentExtractionError(
            `Dung lượng file (${(stat.size / 1024 / 1024).toFixed(1)}MB) vượt quá giới hạn cho phép (tối đa 20MB)`,
            "FILE_TOO_LARGE",
        );
    }

    try {
        const buffer = fs.readFileSync(filePath);
        const parser = new PDFParse(new Uint8Array(buffer));

        const parseOperation = (async () => {
            await parser.load();
            const textResult = await parser.getText();
            return textResult;
        })();

        const result = await withTimeout(
            parseOperation,
            EXTRACTION_TIMEOUT_MS,
            "Thời gian xử lý tài liệu PDF vượt quá giới hạn 10 giây",
        );

        const fullText = (result.text || "").trim();
        const totalPages = result.total || 1;

        // Check if the PDF has actual text layer or is a scanned image
        const nonWhitespaceCount = fullText.replace(/\s+/g, "").length;
        if (nonWhitespaceCount < 10) {
            return {
                format: "PDF",
                totalPages,
                pages: [],
                fullText: "",
                isScanned: true,
                note: "Tài liệu là PDF dạng scan (hình ảnh), chưa có lớp văn bản số để trích xuất (chưa hỗ trợ OCR).",
            };
        }

        // Split text into pages if separator exists
        const rawPages = fullText
            .split(/--\s*\d+\s+of\s+\d+\s*--/gi)
            .map((p) => p.trim())
            .filter(Boolean);
        const pages = rawPages.length > 0 ? rawPages : [fullText];

        return {
            format: "PDF",
            totalPages,
            pages,
            fullText,
            isScanned: false,
        };
    } catch (err) {
        if (err instanceof DocumentExtractionError) throw err;
        const msg = (err.message || "").toLowerCase();
        if (msg.includes("password") || msg.includes("encrypted")) {
            throw new DocumentExtractionError(
                "Tài liệu PDF có mật khẩu bảo vệ, vui lòng gỡ mật khẩu trước khi tải lên.",
                "PASSWORD_PROTECTED",
            );
        }
        throw new DocumentExtractionError(
            `Không thể đọc tài liệu PDF: ${err.message || "File lỗi hoặc không đúng định dạng"}`,
            "PDF_CORRUPT",
        );
    }
}

/**
 * Main extractor function for any supported document
 * @param {string} filePath Absolute path to file
 * @param {object} options { page?: number, offset?: number, limit?: number }
 */
export async function extractDocument(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
        throw new DocumentExtractionError(`File không tồn tại: ${filePath}`, "NOT_FOUND");
    }

    const ext = path.extname(filePath).toLowerCase();
    let extracted;

    switch (ext) {
        case ".pdf":
            extracted = await extractPdf(filePath);
            break;
        case ".docx":
            extracted = await extractDocx(filePath);
            break;
        case ".txt":
            extracted = await extractTxt(filePath);
            break;
        default:
            throw new DocumentExtractionError(
                `Định dạng file "${ext}" chưa được hỗ trợ. Hệ thống hỗ trợ .pdf, .docx và .txt (UTF-8).`,
                "UNSUPPORTED_FORMAT",
            );
    }

    if (extracted.isScanned) {
        return {
            filePath,
            format: extracted.format,
            totalPages: extracted.totalPages,
            totalCharacters: 0,
            content: "",
            hasMore: false,
            note: extracted.note,
        };
    }

    const { page, offset = 0, limit = DEFAULT_CHUNK_CHARS } = options;

    // If specific page requested and page is valid
    if (typeof page === "number" && page >= 1) {
        const pageIndex = page - 1;
        if (pageIndex >= extracted.pages.length) {
            throw new DocumentExtractionError(
                `Trang ${page} vượt quá tổng số trang (${extracted.totalPages}) của tài liệu.`,
                "PAGE_OUT_OF_RANGE",
            );
        }
        const pageContent = extracted.pages[pageIndex];
        return {
            filePath,
            format: extracted.format,
            totalPages: extracted.totalPages,
            page,
            totalCharacters: pageContent.length,
            offset: 0,
            limit: pageContent.length,
            hasMore: false,
            content: pageContent,
        };
    }

    // Chunking/pagination by character offset
    const fullText = extracted.fullText;
    const totalLength = fullText.length;
    const start = Math.max(0, Number(offset) || 0);
    const end = Math.min(totalLength, start + (Number(limit) || DEFAULT_CHUNK_CHARS));

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
        ...(hasMore ? { nextOffset: end } : {}),
    };
}

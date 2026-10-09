import path from "node:path";
import { authenticateRequest, parseJsonBody, sendJson } from "./auth.js";
import { extractDocument, DocumentExtractionError, MAX_FILE_SIZE_BYTES } from "./document-extractor.js";
import { checkDocumentAccess, getOwnerOfSession } from "./workspace.js";
import { recordAttachment, getAttachmentsByUser, findAttachment } from "./db.js";
import { createReadDocumentTool } from "./document-tool.js";

let cordisCtx = null;

export const toolRegistrationStatus = {
    ready: false,
    toolRegistered: false,
    promptInjected: false,
    error: null,
};

export function setDocumentServiceContext(ctx) {
    cordisCtx = ctx;
}

/**
 * Hook into DSH fileUploads service to record attachment ownership automatically.
 * Rejects tracking for unowned sessions, never defaults to 'admin', and ignores empty file paths.
 */
export function hookFileUploadsService(fileUploads, attachments) {
    if (!fileUploads || fileUploads.__dshTrackHooked) return;
    fileUploads.__dshTrackHooked = true;

    const originalUploadStream = fileUploads.uploadStream.bind(fileUploads);
    fileUploads.uploadStream = async function (request) {
        const result = await originalUploadStream(request);
        try {
            const sessionId = request?.sessionId;
            if (!sessionId) return result;

            const owner = getOwnerOfSession(sessionId);
            if (!owner) {
                console.warn(
                    `[dsh-plugin-user-manager] Upload rejected from attachment tracker: Session "${sessionId}" has no verified owner.`,
                );
                return result;
            }

            let hostPath = "";
            if (attachments && typeof attachments.fileHostPath === "function") {
                hostPath = attachments.fileHostPath(result?.file);
            }

            if (result && result.file && hostPath && hostPath.trim()) {
                recordAttachment({
                    attachmentId: result.file.attachmentId,
                    fileName: result.file.name,
                    fileSize: result.file.bytes || 0,
                    sessionId,
                    username: owner,
                    filePath: hostPath,
                });
                console.log(
                    `[dsh-plugin-user-manager] Tracked upload: ${result.file.name} for user "${owner}" (session: ${sessionId})`,
                );
            }
        } catch (e) {
            console.error("[dsh-plugin-user-manager] Error tracking uploaded attachment in hook:", e.message);
        }
        return result;
    };
    console.log("[dsh-plugin-user-manager] Attachment tracker hooked into fileUploads service.");
}

/**
 * Register document REST endpoints on ctx.webServer
 */
export function registerDocumentRoutes(webServer) {
    // 1. Intercept uploadFileBinary for authenticated multi-user upload gatekeeping & tracking
    webServer.register({
        kind: "exact",
        path: "/api/session/uploadFileBinary",
        handler: async (req, res) => {
            const user = authenticateRequest(req);
            if (!user) {
                return sendJson(res, 401, {
                    ok: false,
                    error: { code: "auth/unauthorized", message: "Bạn cần đăng nhập để tải lên tài liệu." },
                });
            }

            // Check Content-Length header early
            const contentLength = req.headers["content-length"];
            if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
                return sendJson(res, 413, {
                    ok: false,
                    error: {
                        code: "upload/too_large",
                        message: `Dung lượng file vượt quá giới hạn tối đa cho phép (20MB).`,
                    },
                });
            }

            const url = new URL(req.url, "http://localhost");
            const sessionId = url.searchParams.get("sessionId");
            const name = url.searchParams.get("name") || "attachment";

            if (!sessionId) {
                return sendJson(res, 400, {
                    ok: false,
                    error: { code: "session/required", message: "sessionId là bắt buộc." },
                });
            }

            // Verify that this sessionId has a verified owner and belongs to this authenticated user
            const owner = getOwnerOfSession(sessionId);
            if (!owner) {
                return sendJson(res, 403, {
                    ok: false,
                    error: {
                        code: "session/unowned",
                        message: "Phiên làm việc chưa được gán chủ sở hữu hợp lệ. Không thể tải file lên.",
                    },
                });
            }

            if (owner !== user.username) {
                return sendJson(res, 403, {
                    ok: false,
                    error: {
                        code: "session/forbidden",
                        message: "Bạn không có quyền tải file lên session của người dùng khác.",
                    },
                });
            }

            const fileUploads = cordisCtx?.get ? cordisCtx.get("fileUploads") : null;
            const attachments = cordisCtx?.get ? cordisCtx.get("attachments") : null;

            if (!fileUploads) {
                return sendJson(res, 500, {
                    ok: false,
                    error: { code: "gateway/internal", message: "Dịch vụ file upload chưa sẵn sàng." },
                });
            }

            try {
                let receivedBytes = 0;
                async function* requestChunks(stream) {
                    for await (const chunk of stream) {
                        receivedBytes += chunk.length;
                        if (receivedBytes > MAX_FILE_SIZE_BYTES) {
                            const err = new Error(`Dung lượng file vượt quá giới hạn tối đa 20MB.`);
                            err.status = 413;
                            throw err;
                        }
                        yield chunk;
                    }
                }

                const uploadResult = await fileUploads.uploadStream({
                    sessionId,
                    data: requestChunks(req),
                    name,
                });

                let hostPath = "";
                try {
                    if (attachments && typeof attachments.fileHostPath === "function") {
                        hostPath = attachments.fileHostPath(uploadResult.file);
                    }
                } catch (e) {}

                // Only record here if hookFileUploadsService is NOT already handling it
                if (!fileUploads.__dshTrackHooked && hostPath && hostPath.trim()) {
                    recordAttachment({
                        attachmentId: uploadResult.file.attachmentId,
                        fileName: uploadResult.file.name,
                        fileSize: uploadResult.file.bytes || 0,
                        sessionId,
                        username: user.username,
                        filePath: hostPath,
                    });
                }

                console.log(
                    `[dsh-plugin-user-manager] Authenticated upload success: ${uploadResult.file.name} (user: ${user.username})`,
                );

                return sendJson(res, 200, {
                    ok: true,
                    value: uploadResult,
                });
            } catch (err) {
                const statusCode = err.status || 500;
                return sendJson(res, statusCode, {
                    ok: false,
                    error: {
                        code: statusCode === 413 ? "upload/too_large" : "gateway/internal",
                        message: err.message || String(err),
                    },
                });
            }
        },
    });

    // 2. POST /api/document/read - Document preview & extraction endpoint
    webServer.register({
        kind: "exact",
        path: "/api/document/read",
        handler: async (req, res) => {
            if (req.method !== "POST") {
                return sendJson(res, 405, { error: "Method Not Allowed" });
            }

            const user = authenticateRequest(req);
            if (!user) {
                return sendJson(res, 401, { error: "Yêu cầu đăng nhập." });
            }

            try {
                const body = await parseJsonBody(req);
                const { file_path, page, offset, limit, session_id } = body;

                if (!file_path) {
                    return sendJson(res, 400, { error: 'Tham số "file_path" là bắt buộc.' });
                }

                // Validate access security (workspace file or owned attachment)
                const verifiedPath = checkDocumentAccess(user.username, file_path, session_id || null);

                const extracted = await extractDocument(verifiedPath, {
                    page: typeof page === "number" ? page : undefined,
                    offset: typeof offset === "number" ? offset : undefined,
                    limit: typeof limit === "number" ? limit : undefined,
                });

                return sendJson(res, 200, {
                    ok: true,
                    data: extracted,
                });
            } catch (err) {
                const status = err.status || (err instanceof DocumentExtractionError ? 400 : 500);
                return sendJson(res, status, {
                    ok: false,
                    error: err.message || "Lỗi khi trích xuất tài liệu",
                    code: err.code || "UNKNOWN_ERROR",
                });
            }
        },
    });

    // 3. GET /api/document/attachments - List attachments owned by user
    webServer.register({
        kind: "exact",
        path: "/api/document/attachments",
        handler: async (req, res) => {
            const user = authenticateRequest(req);
            if (!user) {
                return sendJson(res, 401, { error: "Yêu cầu đăng nhập." });
            }

            try {
                const items = getAttachmentsByUser(user.username);
                return sendJson(res, 200, {
                    ok: true,
                    attachments: items,
                });
            } catch (err) {
                return sendJson(res, 500, { error: err.message });
            }
        },
    });

    console.log(
        "[dsh-plugin-user-manager] Document API endpoints registered (/api/document/read, /api/session/uploadFileBinary).",
    );
}

/**
 * Register read_document Tool into Cordis context for LLM agents
 */
export async function registerCordisDocumentTool(ctx) {
    try {
        const tool = await createReadDocumentTool();

        // Register whenever tools service is present
        ctx.inject(["tools"], (toolsScope) => {
            try {
                toolsScope.tools.register(tool);
                toolRegistrationStatus.toolRegistered = true;
                if (toolRegistrationStatus.promptInjected) {
                    toolRegistrationStatus.ready = true;
                }
                console.log('[dsh-plugin-user-manager] Tool "read_document" registered into Agent tools.');
            } catch (e) {
                toolRegistrationStatus.toolRegistered = false;
                toolRegistrationStatus.error = e.message;
                console.error("[dsh-plugin-user-manager] Error registering tool into toolsScope:", e.message);
            }
        });

        // Provide system prompt hint so AI automatically knows how to read documents
        ctx.inject(["systemPrompt"], (promptScope) => {
            try {
                const defaultOrder =
                    (typeof promptScope.systemPrompt?.getSectionOrder === "function"
                        ? promptScope.systemPrompt.getSectionOrder("TOOL_READ")
                        : undefined) ?? 500;
                promptScope.systemPrompt.section({
                    name: "tool:read_document",
                    order: defaultOrder + 1,
                    text: () =>
                        "Khi người dùng đính kèm file tài liệu (.pdf, .docx, .txt) hoặc yêu cầu xem nội dung file văn bản, hãy sử dụng công cụ `read_document` với đường dẫn file (file_path) được cung cấp trong thông báo đính kèm. Đối với tài liệu dài, hãy sử dụng tham số `offset` hoặc `page` để đọc tiếp các phần sau.",
                });
                toolRegistrationStatus.promptInjected = true;
                if (toolRegistrationStatus.toolRegistered) {
                    toolRegistrationStatus.ready = true;
                }
                console.log("[dsh-plugin-user-manager] Document reading instructions injected into system prompt.");
            } catch (e) {
                toolRegistrationStatus.promptInjected = false;
                toolRegistrationStatus.error = e.message;
                console.error("[dsh-plugin-user-manager] Error registering systemPrompt section:", e.message);
            }
        });
    } catch (err) {
        toolRegistrationStatus.ready = false;
        toolRegistrationStatus.error = err.message;
        console.error("[dsh-plugin-user-manager] Failed to setup Cordis document tool:", err);
    }
}

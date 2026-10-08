import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { extractDocument, DocumentExtractionError, MAX_FILE_SIZE_BYTES } from "../lib/document-extractor.js";
import { getUserWorkspaceDir, checkDocumentAccess, getOwnerOfSession } from "../lib/workspace.js";
import { recordAttachment, checkAttachmentOwnership, initDatabase, findUserByUsername, createUser } from "../lib/db.js";
import { createReadDocumentTool, executeReadDocument } from "../lib/document-tool.js";

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");

async function runTests() {
    console.log("===============================================================");
    console.log("  CHƯƠNG TRÌNH KIỂM THỬ TÍCH HỢP ĐỌC TÀI LIỆU DSH MULTI-USER   ");
    console.log("===============================================================\n");

    // Initialize DB
    initDatabase();

    const userA = "nta";
    const userB = "nva";

    const dirA = getUserWorkspaceDir(userA);
    const dirB = getUserWorkspaceDir(userB);

    console.log(`[INFO] Workspace User A (${userA}): ${dirA}`);
    console.log(`[INFO] Workspace User B (${userB}): ${dirB}`);

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        return (async () => {
            try {
                await fn();
                console.log(`  [PASS] ${name}`);
                passed++;
            } catch (err) {
                console.error(`  [FAIL] ${name}`);
                console.error(`         Lỗi: ${err.message}`);
                failed++;
            }
        })();
    }

    // -------------------------------------------------------------
    // Test Suite 1: Trích xuất nội dung tiếng Việt (PDF, DOCX, TXT)
    // -------------------------------------------------------------
    console.log("\n--- Test Suite 1: Trích xuất nội dung văn bản tiếng Việt ---");

    // 1.1 TXT UTF-8 có dấu & BOM
    const sampleTxtPath = path.join(dirA, "test_vietnamese.txt");
    const sampleTxtContent =
        "\uFEFFCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\nĐây là tài liệu thử nghiệm tiếng Việt có dấu: Hà Nội, Đà Nẵng, TP. Hồ Chí Minh, Cần Thơ.\nThử nghiệm độ dài và ký tự đặc biệt: ă, â, đ, ê, ô, ơ, ư.";
    fs.writeFileSync(sampleTxtPath, sampleTxtContent, "utf8");

    await test("1.1 Đọc đúng tiếng Việt UTF-8 (có BOM, dấu câu) từ file TXT", async () => {
        const res = await extractDocument(sampleTxtPath);
        assert.strictEqual(res.format, "TXT");
        assert.ok(res.content.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"));
        assert.ok(res.content.includes("Hà Nội, Đà Nẵng, TP. Hồ Chí Minh"));
        assert.ok(res.content.includes("ă, â, đ, ê, ô, ơ, ư"));
    });

    // 1.2 DOCX tiếng Việt
    const sampleDocxAttachment =
        "C:/Users/Admin/.dsh-multiuser/attachments/v1/files/2d/2dc9b0845f0a49c14b9ae2f853c5efd426b8d186e1c3cd95f5a4cd7ef62679ea/bien_ban_MTG-2026-BCH-08.docx";
    await test("1.2 Trích xuất đúng tiếng Việt từ tài liệu Word (.docx)", async () => {
        assert.ok(fs.existsSync(sampleDocxAttachment), "File DOCX mẫu phải tồn tại");
        const res = await extractDocument(sampleDocxAttachment);
        assert.strictEqual(res.format, "DOCX");
        assert.ok(res.content.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"));
        assert.ok(res.content.includes("KỲ HỌP BAN CHẤP HÀNH THƯỜNG KỲ"));
        assert.ok(res.content.includes("Trần Văn Minh"));
        assert.ok(res.totalCharacters > 2000);
    });

    // 1.3 PDF tiếng Việt có text layer
    const samplePdfAttachment =
        "C:/Users/Admin/.dsh-multiuser/attachments/v1/files/81/8128d3005971dbd2f8a4545f322e73b7a26b8fb1c439c44072bad72cd670b4ec/6. Phieu đanh gia KQRL- áp dụng từ năm học 2024- 2025-1.pdf";
    await test("1.3 Trích xuất đúng tiếng Việt từ tài liệu PDF có text layer", async () => {
        assert.ok(fs.existsSync(samplePdfAttachment), "File PDF mẫu phải tồn tại");
        const res = await extractDocument(samplePdfAttachment);
        assert.strictEqual(res.format, "PDF");
        assert.strictEqual(res.totalPages, 2);
        assert.ok(res.content.includes("BỘ GIÁO DỤC VÀ ĐÀO TẠO"));
        assert.ok(res.content.includes("PHIẾU ĐÁNH GIÁ KẾT QUẢ RÈN LUYỆN"));
        assert.ok(res.content.includes("TRƯỜNG ĐẠI HỌC MỎ - ĐỊA CHẤT"));
    });

    // 1.4 Phân trang & Chunking
    await test("1.4 Hỗ trợ phân trang PDF (page=1, page=2) và chunking theo offset", async () => {
        const page1 = await extractDocument(samplePdfAttachment, { page: 1 });
        assert.strictEqual(page1.page, 1);
        assert.ok(page1.content.includes("BỘ GIÁO DỤC VÀ ĐÀO TẠO"));

        const chunk1 = await extractDocument(sampleDocxAttachment, { offset: 0, limit: 100 });
        assert.strictEqual(chunk1.limit, 100);
        assert.strictEqual(chunk1.hasMore, true);
        assert.strictEqual(chunk1.nextOffset, 100);

        const chunk2 = await extractDocument(sampleDocxAttachment, { offset: 100, limit: 100 });
        assert.strictEqual(chunk2.offset, 100);
        assert.notStrictEqual(chunk1.content, chunk2.content);
    });

    // 1.5 Báo rõ ràng khi gặp PDF Scan (không có text layer)
    const mockScannedPdf = path.join(dirA, "mock_scanned.pdf");
    // Create minimal valid empty PDF with no text elements
    const minimalPdfBytes = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n",
    );
    fs.writeFileSync(mockScannedPdf, minimalPdfBytes);

    await test("1.5 Phát hiện PDF scan và báo rõ ràng chưa hỗ trợ OCR", async () => {
        const res = await extractDocument(mockScannedPdf);
        assert.strictEqual(res.format, "PDF");
        assert.strictEqual(res.totalCharacters, 0);
        assert.ok(res.note.includes("chưa có lớp văn bản số để trích xuất (chưa hỗ trợ OCR)"));
    });

    // 1.6 Báo lỗi định dạng không hỗ trợ & file nhị phân giả mạo TXT
    const invalidTxtPath = path.join(dirA, "binary_fake.txt");
    fs.writeFileSync(invalidTxtPath, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
    await test("1.6 Bắt lỗi mã hóa không hợp lệ (binary giả TXT)", async () => {
        try {
            await extractDocument(invalidTxtPath);
            assert.fail("Phải ném lỗi khi file TXT chứa binary null bytes");
        } catch (e) {
            assert.strictEqual(e.code, "INVALID_ENCODING");
        }
    });

    // -------------------------------------------------------------
    // Test Suite 2: Phân quyền & Cô lập tài khoản (Multi-User Isolation)
    // -------------------------------------------------------------
    console.log("\n--- Test Suite 2: Kiểm tra phân quyền & Cô lập dữ liệu ---");

    // Ghi nhận file đính kèm thuộc sở hữu của User A
    const fakeSessionA = "session-nta-test-doc-001";
    const fakeSessionB = "session-nva-test-doc-002";
    const attachmentUserA = sampleDocxAttachment;

    recordAttachment({
        attachmentId: "sha256:2dc9b0845f0a49c14b9ae2f853c5efd426b8d186e1c3cd95f5a4cd7ef62679ea",
        fileName: "bien_ban_MTG-2026-BCH-08.docx",
        fileSize: 2670,
        sessionId: fakeSessionA,
        username: userA,
        filePath: attachmentUserA,
    });

    // 2.1 User A truy cập file trong workspace User A -> Hợp lệ
    await test("2.1 User A đọc thành công file trong workspace của chính mình", async () => {
        const verified = checkDocumentAccess(userA, "test_vietnamese.txt");
        assert.strictEqual(path.resolve(verified), path.resolve(sampleTxtPath));
    });

    // 2.2 User A đọc attachment thuộc sở hữu của mình -> Hợp lệ
    await test("2.2 User A đọc thành công attachment do mình tải lên", async () => {
        const verified = checkDocumentAccess(userA, attachmentUserA);
        assert.strictEqual(path.resolve(verified), path.resolve(attachmentUserA));
    });

    // 2.3 User B cố tình truy cập file trong workspace User A -> BỊ CHẶN 403
    await test("2.3 Chặn User B truy cập chéo file workspace của User A (Relative path traversal)", async () => {
        try {
            checkDocumentAccess(userB, `../${userA}/test_vietnamese.txt`);
            assert.fail("User B không được phép đọc file của User A");
        } catch (e) {
            assert.strictEqual(e.status, 403);
            assert.ok(e.message.includes("Truy cập bị từ chối"));
        }
    });

    // 2.4 User B cố tình truy cập file của User A qua đường dẫn tuyệt đối
    await test("2.4 Chặn User B truy cập chéo file workspace của User A (Absolute path)", async () => {
        try {
            checkDocumentAccess(userB, sampleTxtPath);
            assert.fail("User B không được phép đọc file của User A");
        } catch (e) {
            assert.strictEqual(e.status, 403);
            assert.ok(e.message.includes("Truy cập bị từ chối"));
        }
    });

    // 2.5 User B cố tình truy cập attachment của User A -> BỊ CHẶN 403
    await test("2.5 Chặn User B truy cập file đính kèm (attachment) của User A", async () => {
        try {
            checkDocumentAccess(userB, attachmentUserA);
            assert.fail("User B không được phép đọc attachment của User A");
        } catch (e) {
            assert.strictEqual(e.status, 403);
            assert.ok(e.message.includes('không thuộc về phiên làm việc của người dùng "nva"'));
        }
    });

    // 2.6 Chặn Path Traversal hệ thống (C:\Windows\System32 hoặc ../../)
    await test("2.6 Chặn triệt để Path Traversal ngoài workspace", async () => {
        try {
            checkDocumentAccess(userA, "../../../../Windows/win.ini");
            assert.fail("Không được phép thoát khỏi workspace");
        } catch (e) {
            assert.ok(e.status === 403 || e.status === 404);
        }
    });

    // -------------------------------------------------------------
    // Test Suite 3: Tool read_document trong phiên Agent của AI
    // -------------------------------------------------------------
    console.log("\n--- Test Suite 3: Kiểm thử Tool read_document cho Agent AI ---");

    // Khởi tạo tool Cordis
    const tool = await createReadDocumentTool();
    assert.strictEqual(tool.name, "read_document");

    // 3.1 Agent User A gọi read_document đọc file workspace của mình
    await test("3.1 AI của User A gọi read_document đọc thành công file workspace", async () => {
        const mockExecA = {
            agent: {
                id: fakeSessionA,
                session: {
                    id: fakeSessionA,
                    header: {
                        cwd: dirA,
                    },
                },
            },
        };

        const result = await executeReadDocument({ file_path: "test_vietnamese.txt" }, mockExecA);
        assert.strictEqual(result.format, "TXT");
        assert.ok(result.content.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"));
    });

    // 3.2 Agent User A gọi read_document đọc attachment của mình
    await test("3.2 AI của User A gọi read_document đọc thành công attachment DOCX", async () => {
        const mockExecA = {
            agent: {
                id: fakeSessionA,
                session: {
                    id: fakeSessionA,
                    header: {
                        cwd: dirA,
                    },
                },
            },
        };

        const result = await executeReadDocument({ file_path: attachmentUserA, limit: 200 }, mockExecA);
        assert.strictEqual(result.format, "DOCX");
        assert.ok(result.content.includes("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"));
        assert.strictEqual(result.has_more, true);
    });

    // 3.3 Agent User B cố tình gọi read_document vào file của User A -> Bị từ chối
    await test("3.3 AI của User B gọi read_document vào file của User A -> BỊ TỪ CHỐI", async () => {
        const mockExecB = {
            agent: {
                id: fakeSessionB,
                session: {
                    id: fakeSessionB,
                    header: {
                        cwd: dirB,
                    },
                },
            },
        };

        try {
            await executeReadDocument({ file_path: sampleTxtPath }, mockExecB);
            assert.fail("Model của User B không được phép đọc file của User A");
        } catch (e) {
            assert.ok(e.message.includes("Truy cập bị từ chối"));
        }
    });

    // Dọn dẹp file mock test
    try {
        fs.rmSync(sampleTxtPath, { force: true });
    } catch (e) {}
    try {
        fs.rmSync(mockScannedPdf, { force: true });
    } catch (e) {}
    try {
        fs.rmSync(invalidTxtPath, { force: true });
    } catch (e) {}

    console.log("\n===============================================================");
    console.log(`  KẾT QUẢ KIỂM THỬ: ${passed} PASS, ${failed} FAIL`);
    console.log("===============================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("[ERROR] Uncaught test error:", err);
    process.exit(1);
});

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { initDatabase, findUserByUsername, createUser, recordAttachment, getDb } from "../lib/db.js";

const LIVE_DSH_URL = "http://127.0.0.1:3088";
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(PLUGIN_ROOT, "data", "users.db");
const DSH_HOME = "C:\\Users\\Admin\\.dsh-multiuser";
const ATT_DIR = path.join(DSH_HOME, "attachments", "v1", "files");
const WS_ROOT = path.join(PLUGIN_ROOT, "workspaces");

async function main() {
    console.log("======================================================================");
    console.log("   KIỂM THỬ NÂNG CAO GUARD VÀ CÔ LẬP THỰC THI QUA DSH TOOLRUNTIME    ");
    console.log("   1. Đọc file hợp lệ trong workspace của chính user                  ");
    console.log("   2. Chạy script trong workspace, script đọc file user khác          ");
    console.log("   3. Dùng đường dẫn tạo động (dynamic path) đọc file user khác       ");
    console.log("   - Kiểm tra cả Workspace và Attachment, hai chiều nvs <-> nva       ");
    console.log("======================================================================\n");

    initDatabase(DB_PATH);
    const userPassword = process.env.TEST_USER_PASSWORD || "123456";

    // 1. Chuẩn bị session cho nvs và nva
    console.log("[BƯỚC 1] Khởi tạo phiên xác thực thật cho nvs và nva...");

    // Login nvs
    const resLoginNvs = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nvs", password: userPassword }),
    });
    assert.strictEqual(resLoginNvs.status, 200);
    const cookieNvs = resLoginNvs.headers.get("set-cookie")?.split(";")[0];

    // Login nva
    const resLoginNva = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nva", password: userPassword }),
    });
    assert.strictEqual(resLoginNva.status, 200);
    const cookieNva = resLoginNva.headers.get("set-cookie")?.split(";")[0];

    // Create real session for nvs
    const resSessNvs = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNvs },
        body: JSON.stringify({ workspaceId: "user-workspace-nvs", agentPreset: "standard" }),
    });
    const dataSessNvs = await resSessNvs.json();
    const sessionNvs = dataSessNvs.result?.value?.sessionId || dataSessNvs.sessionId;

    // Create real session for nva
    const resSessNva = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNva },
        body: JSON.stringify({ workspaceId: "user-workspace-nva", agentPreset: "standard" }),
    });
    const dataSessNva = await resSessNva.json();
    const sessionNva = dataSessNva.result?.value?.sessionId || dataSessNva.sessionId;

    console.log(`  -> Session nvs: ${sessionNvs}`);
    console.log(`  -> Session nva: ${sessionNva}`);

    // 2. Chuẩn bị file dữ liệu giả lập
    console.log("\n[BƯỚC 2] Tạo file giả lập bí mật cho workspace và attachment...");
    const wsNvs = path.join(WS_ROOT, "nvs");
    const wsNva = path.join(WS_ROOT, "nva");
    fs.mkdirSync(wsNvs, { recursive: true });
    fs.mkdirSync(wsNva, { recursive: true });

    const SECRET_WS_NVS = "CONFIDENTIAL_NVS_WORKSPACE_DATA_881122";
    const SECRET_WS_NVA = "CONFIDENTIAL_NVA_WORKSPACE_DATA_334455";
    const SECRET_ATT_NVS = "CONFIDENTIAL_NVS_ATTACHMENT_DATA_667788";
    const SECRET_ATT_NVA = "CONFIDENTIAL_NVA_ATTACHMENT_DATA_990011";

    const fileWsNvs = path.join(wsNvs, "secret_nvs.txt");
    const fileWsNva = path.join(wsNva, "secret_nva.txt");
    fs.writeFileSync(fileWsNvs, SECRET_WS_NVS, "utf8");
    fs.writeFileSync(fileWsNva, SECRET_WS_NVA, "utf8");

    // Attachments
    const dirAttNvs = path.join(ATT_DIR, "fake_adv_sec_nvs");
    const dirAttNva = path.join(ATT_DIR, "fake_adv_sec_nva");
    fs.mkdirSync(dirAttNvs, { recursive: true });
    fs.mkdirSync(dirAttNva, { recursive: true });

    const fileAttNvs = path.join(dirAttNvs, "test-nvs.txt");
    const fileAttNva = path.join(dirAttNva, "test-nva.txt");
    fs.writeFileSync(fileAttNvs, SECRET_ATT_NVS, "utf8");
    fs.writeFileSync(fileAttNva, SECRET_ATT_NVA, "utf8");

    recordAttachment({
        attachmentId: "sha256:fake_adv_nvs_1",
        fileName: "test-nvs.txt",
        fileSize: SECRET_ATT_NVS.length,
        sessionId: sessionNvs,
        username: "nvs",
        filePath: fileAttNvs,
    });

    recordAttachment({
        attachmentId: "sha256:fake_adv_nva_1",
        fileName: "test-nva.txt",
        fileSize: SECRET_ATT_NVA.length,
        sessionId: sessionNva,
        username: "nva",
        filePath: fileAttNva,
    });

    // Helper thực thi qua DSH ToolRuntime thật
    async function execTool(cookie, sessionId, command) {
        const res = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: cookie,
            },
            body: JSON.stringify({
                sessionId,
                toolName: "pwsh",
                args: { command, description: "Test command" },
            }),
        });
        const json = await res.json();
        return json.result;
    }

    const testReport = [];

    // =========================================================================
    // PHẦN 1: SHELL ĐỌC FILE TRONG WORKSPACE CHÍNH USER (PHẢI THÀNH CÔNG)
    // =========================================================================
    console.log("\n--- PHẦN 1: SHELL ĐỌC FILE WORKSPACE CHÍNH CHỦ ---");
    {
        // 1.1 nvs reads own file
        const r11 = await execTool(cookieNvs, sessionNvs, `Get-Content -LiteralPath "${path.basename(fileWsNvs)}"`);
        const pass11 = !r11.isError && r11.content?.[0]?.text?.includes(SECRET_WS_NVS);
        testReport.push({
            name: "1.1 nvs đọc file của chính mình",
            pass: pass11,
            details: r11.content?.[0]?.text?.trim(),
        });
        console.log(`  [${pass11 ? "PASS" : "FAIL"}] 1.1 nvs đọc file của mình: ${pass11 ? "Thành công" : "Thất bại"}`);

        // 1.2 nva reads own file
        const r12 = await execTool(cookieNva, sessionNva, `Get-Content -LiteralPath "${path.basename(fileWsNva)}"`);
        const pass12 = !r12.isError && r12.content?.[0]?.text?.includes(SECRET_WS_NVA);
        testReport.push({
            name: "1.2 nva đọc file của chính mình",
            pass: pass12,
            details: r12.content?.[0]?.text?.trim(),
        });
        console.log(`  [${pass12 ? "PASS" : "FAIL"}] 1.2 nva đọc file của mình: ${pass12 ? "Thành công" : "Thất bại"}`);
    }

    // =========================================================================
    // PHẦN 2: SHELL CHẠY SCRIPT TRONG WORKSPACE ĐỌC FILE BÍ MẬT CỦA USER KHÁC
    // =========================================================================
    console.log("\n--- PHẦN 2: SHELL CHẠY SCRIPT TRONG WORKSPACE ĐỌC FILE USER KHÁC ---");
    {
        // 2.1 nvs chạy script_ws.ps1 đọc workspace file của nva
        const scriptWsNvs = path.join(wsNvs, "read_other_ws.ps1");
        fs.writeFileSync(scriptWsNvs, `Get-Content -LiteralPath "${fileWsNva}"`, "utf8");

        const r21 = await execTool(
            cookieNvs,
            sessionNvs,
            `powershell -ExecutionPolicy Bypass -File .\\read_other_ws.ps1`,
        );
        const blocked21 = r21.isError || !r21.content?.[0]?.text?.includes(SECRET_WS_NVA);
        testReport.push({
            name: "2.1 nvs chạy script nội bộ đọc workspace nva",
            blocked: blocked21,
            outputLeaked: r21.content?.[0]?.text?.includes(SECRET_WS_NVA),
        });
        console.log(
            `  -> 2.1 nvs chạy script đọc workspace nva: ${blocked21 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 2.2 nvs chạy script_att.ps1 đọc attachment của nva
        const scriptAttNvs = path.join(wsNvs, "read_other_att.ps1");
        fs.writeFileSync(scriptAttNvs, `Get-Content -LiteralPath "${fileAttNva}"`, "utf8");

        const r22 = await execTool(
            cookieNvs,
            sessionNvs,
            `powershell -ExecutionPolicy Bypass -File .\\read_other_att.ps1`,
        );
        const blocked22 = r22.isError || !r22.content?.[0]?.text?.includes(SECRET_ATT_NVA);
        testReport.push({
            name: "2.2 nvs chạy script nội bộ đọc attachment nva",
            blocked: blocked22,
            outputLeaked: r22.content?.[0]?.text?.includes(SECRET_ATT_NVA),
        });
        console.log(
            `  -> 2.2 nvs chạy script đọc attachment nva: ${blocked22 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 2.3 Chiều ngược lại: nva chạy script đọc workspace file của nvs
        const scriptWsNva = path.join(wsNva, "read_other_ws.ps1");
        fs.writeFileSync(scriptWsNva, `Get-Content -LiteralPath "${fileWsNvs}"`, "utf8");

        const r23 = await execTool(
            cookieNva,
            sessionNva,
            `powershell -ExecutionPolicy Bypass -File .\\read_other_ws.ps1`,
        );
        const blocked23 = r23.isError || !r23.content?.[0]?.text?.includes(SECRET_WS_NVS);
        testReport.push({
            name: "2.3 nva chạy script nội bộ đọc workspace nvs",
            blocked: blocked23,
            outputLeaked: r23.content?.[0]?.text?.includes(SECRET_WS_NVS),
        });
        console.log(
            `  -> 2.3 nva chạy script đọc workspace nvs: ${blocked23 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 2.4 Chiều ngược lại: nva chạy script đọc attachment của nvs
        const scriptAttNva = path.join(wsNva, "read_other_att.ps1");
        fs.writeFileSync(scriptAttNva, `Get-Content -LiteralPath "${fileAttNvs}"`, "utf8");

        const r24 = await execTool(
            cookieNva,
            sessionNva,
            `powershell -ExecutionPolicy Bypass -File .\\read_other_att.ps1`,
        );
        const blocked24 = r24.isError || !r24.content?.[0]?.text?.includes(SECRET_ATT_NVS);
        testReport.push({
            name: "2.4 nva chạy script nội bộ đọc attachment nvs",
            blocked: blocked24,
            outputLeaked: r24.content?.[0]?.text?.includes(SECRET_ATT_NVS),
        });
        console.log(
            `  -> 2.4 nva chạy script đọc attachment nvs: ${blocked24 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );
    }

    // =========================================================================
    // PHẦN 3: SHELL DÙNG ĐƯỜNG DẪN TẠO ĐỘNG (DYNAMIC PATH) ĐỌC FILE USER KHÁC
    // =========================================================================
    console.log("\n--- PHẦN 3: SHELL DÙNG ĐƯỜNG DẪN TẠO ĐỘNG (DYNAMIC PATH CONCATENATION) ---");
    {
        // 3.1 nvs nối chuỗi dynamic path đọc workspace file của nva
        const dynCmd1 = `$target = ".." + "\\" + "nv" + "a" + "\\" + "secret_nva.txt"; Get-Content -LiteralPath $target`;
        const r31 = await execTool(cookieNvs, sessionNvs, dynCmd1);
        const blocked31 = r31.isError || !r31.content?.[0]?.text?.includes(SECRET_WS_NVA);
        testReport.push({
            name: "3.1 nvs tạo dynamic path đọc workspace nva",
            blocked: blocked31,
            outputLeaked: r31.content?.[0]?.text?.includes(SECRET_WS_NVA),
        });
        console.log(
            `  -> 3.1 nvs dynamic path đọc workspace nva: ${blocked31 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 3.2 nvs dùng Join-Path động đọc attachment của nva
        const dynCmd2 = `$base = "C:\\Users\\Admin\\.dsh-multiuser"; $f = "fake_adv_sec_nva"; $p = Join-Path (Join-Path (Join-Path $base "attachments\\v1") "files") "$f\\test-nva.txt"; Get-Content -LiteralPath $p`;
        const r32 = await execTool(cookieNvs, sessionNvs, dynCmd2);
        const blocked32 = r32.isError || !r32.content?.[0]?.text?.includes(SECRET_ATT_NVA);
        testReport.push({
            name: "3.2 nvs tạo dynamic path đọc attachment nva",
            blocked: blocked32,
            outputLeaked: r32.content?.[0]?.text?.includes(SECRET_ATT_NVA),
        });
        console.log(
            `  -> 3.2 nvs dynamic path đọc attachment nva: ${blocked32 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 3.3 Chiều ngược lại: nva nối chuỗi dynamic path đọc workspace nvs
        const dynCmd3 = `$target = ".." + "\\" + "nv" + "s" + "\\" + "secret_nvs.txt"; Get-Content -LiteralPath $target`;
        const r33 = await execTool(cookieNva, sessionNva, dynCmd3);
        const blocked33 = r33.isError || !r33.content?.[0]?.text?.includes(SECRET_WS_NVS);
        testReport.push({
            name: "3.3 nva tạo dynamic path đọc workspace nvs",
            blocked: blocked33,
            outputLeaked: r33.content?.[0]?.text?.includes(SECRET_WS_NVS),
        });
        console.log(
            `  -> 3.3 nva dynamic path đọc workspace nvs: ${blocked33 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );

        // 3.4 Chiều ngược lại: nva tạo dynamic path đọc attachment nvs
        const dynCmd4 = `$base = "C:\\Users\\Admin\\.dsh-multiuser"; $f = "fake_adv_sec_nvs"; $p = Join-Path (Join-Path (Join-Path $base "attachments\\v1") "files") "$f\\test-nvs.txt"; Get-Content -LiteralPath $p`;
        const r34 = await execTool(cookieNva, sessionNva, dynCmd4);
        const blocked34 = r34.isError || !r34.content?.[0]?.text?.includes(SECRET_ATT_NVS);
        testReport.push({
            name: "3.4 nva tạo dynamic path đọc attachment nvs",
            blocked: blocked34,
            outputLeaked: r34.content?.[0]?.text?.includes(SECRET_ATT_NVS),
        });
        console.log(
            `  -> 3.4 nva dynamic path đọc attachment nvs: ${blocked34 ? "BỊ CHẶN" : "KHÔNG BỊ CHẶN (NỘI DUNG ĐÃ BỊ ĐỌC)"}`,
        );
    }

    // Dọn dẹp
    try {
        fs.unlinkSync(fileWsNvs);
        fs.unlinkSync(fileWsNva);
        fs.unlinkSync(fileAttNvs);
        fs.unlinkSync(fileAttNva);
        fs.rmdirSync(dirAttNvs);
        fs.rmdirSync(dirAttNva);
        fs.unlinkSync(path.join(wsNvs, "read_other_ws.ps1"));
        fs.unlinkSync(path.join(wsNvs, "read_other_att.ps1"));
        fs.unlinkSync(path.join(wsNva, "read_other_ws.ps1"));
        fs.unlinkSync(path.join(wsNva, "read_other_att.ps1"));
    } catch (e) {}

    console.log("\n======================================================================");
    console.log("   TỔNG KẾT KẾT QUẢ THỰC TẾ TRÊN TOOLRUNTIME DSH THẬT                ");
    console.log("======================================================================");
    console.table(testReport);
}

main().catch((err) => {
    console.error("\n[LỖI TEST NÂNG CAO]:", err);
    process.exit(1);
});

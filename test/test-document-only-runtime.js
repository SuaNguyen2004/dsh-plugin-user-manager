import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { initDatabase, findUserByUsername, recordAttachment } from "../lib/db.js";

const LIVE_DSH_URL = "http://127.0.0.1:3088";
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(PLUGIN_ROOT, "data", "users.db");
const DSH_HOME = "C:\\Users\\Admin\\.dsh-multiuser";
const ATT_DIR = path.join(DSH_HOME, "attachments", "v1", "files");
const WS_ROOT = path.join(PLUGIN_ROOT, "workspaces");

async function main() {
    console.log("======================================================================");
    console.log("   KIỂM THỬ RUNTIME THẬT: CHẾ ĐỘ DOCUMENT-ONLY CHO USER THƯỜNG       ");
    console.log("======================================================================\n");

    initDatabase(DB_PATH);
    const userPassword = process.env.TEST_USER_PASSWORD || "123456";

    // -------------------------------------------------------------------------
    // BƯỚC 1: XÁC THỰC VÀ KHỞI TẠO PHIÊN CHO NVS, NVA VÀ ADMIN
    // -------------------------------------------------------------------------
    console.log("[BƯỚC 1] Đăng nhập và tạo session thật trong DSH...");

    // Login nvs
    const resLoginNvs = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nvs", password: userPassword }),
    });
    assert.strictEqual(resLoginNvs.status, 200, "Đăng nhập nvs phải thành công");
    const cookieNvs = resLoginNvs.headers.get("set-cookie")?.split(";")[0];

    // Login nva
    const resLoginNva = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nva", password: userPassword }),
    });
    assert.strictEqual(resLoginNva.status, 200, "Đăng nhập nva phải thành công");
    const cookieNva = resLoginNva.headers.get("set-cookie")?.split(";")[0];

    // Login admin
    const resLoginAdmin = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: process.env.TEST_ADMIN_PASSWORD || "admin123" }),
    });
    assert.strictEqual(resLoginAdmin.status, 200, "Đăng nhập admin phải thành công");
    const cookieAdmin = resLoginAdmin.headers.get("set-cookie")?.split(";")[0];

    // Tạo session DSH thật cho nvs
    const resSessNvs = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNvs },
        body: JSON.stringify({ workspaceId: "user-workspace-nvs", agentPreset: "standard" }),
    });
    const dataSessNvs = await resSessNvs.json();
    const sessionNvs = dataSessNvs.result?.value?.sessionId || dataSessNvs.sessionId;

    // Tạo session DSH thật cho nva
    const resSessNva = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNva },
        body: JSON.stringify({ workspaceId: "user-workspace-nva", agentPreset: "standard" }),
    });
    const dataSessNva = await resSessNva.json();
    const sessionNva = dataSessNva.result?.value?.sessionId || dataSessNva.sessionId;

    // Tạo session DSH thật cho admin
    const resSessAdmin = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieAdmin },
        body: JSON.stringify({ workspaceId: "user-workspace-admin", agentPreset: "standard" }),
    });
    const dataSessAdmin = await resSessAdmin.json();
    const sessionAdmin = dataSessAdmin.result?.value?.sessionId || dataSessAdmin.sessionId;

    console.log(`  -> Session nvs: ${sessionNvs}`);
    console.log(`  -> Session nva: ${sessionNva}`);
    console.log(`  -> Session admin: ${sessionAdmin}`);

    // Chuẩn bị file tài liệu kiểm thử
    const dirAttNvs = path.join(ATT_DIR, "doc_only_nvs");
    const dirAttNva = path.join(ATT_DIR, "doc_only_nva");
    fs.mkdirSync(dirAttNvs, { recursive: true });
    fs.mkdirSync(dirAttNva, { recursive: true });

    const CONTENT_NVS_TXT = "CONG_VAN_BAO_MAT_NVS_SO_12345_CHINH_CHU";
    const CONTENT_NVA_TXT = "CONG_VAN_BAO_MAT_NVA_SO_67890_CHINH_CHU";

    const fileNvsTxt = path.join(dirAttNvs, "doc_nvs.txt");
    const fileNvaTxt = path.join(dirAttNva, "doc_nva.txt");
    fs.writeFileSync(fileNvsTxt, CONTENT_NVS_TXT, "utf8");
    fs.writeFileSync(fileNvaTxt, CONTENT_NVA_TXT, "utf8");

    recordAttachment({
        attachmentId: "sha256:doc_only_nvs_txt",
        fileName: "doc_nvs.txt",
        fileSize: CONTENT_NVS_TXT.length,
        sessionId: sessionNvs,
        username: "nvs",
        filePath: fileNvsTxt,
    });

    recordAttachment({
        attachmentId: "sha256:doc_only_nva_txt",
        fileName: "doc_nva.txt",
        fileSize: CONTENT_NVA_TXT.length,
        sessionId: sessionNva,
        username: "nva",
        filePath: fileNvaTxt,
    });

    // Helper gọi Tool qua DSH ToolRuntime thật
    async function execToolRuntime(cookie, sessionId, toolName, args) {
        const res = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: cookie,
            },
            body: JSON.stringify({ sessionId, toolName, args }),
        });
        const json = await res.json();
        return json.result;
    }

    const testResults = [];

    // =========================================================================
    // TEST 1: USER ĐỌC ĐƯỢC TÀI LIỆU MÌNH UPLOAD QUA READ_DOCUMENT
    // =========================================================================
    console.log("\n--- TEST 1: User đọc được tài liệu mình upload qua read_document ---");
    {
        // 1.1 nvs đọc doc_nvs.txt của chính mình
        const r11 = await execToolRuntime(cookieNvs, sessionNvs, "read_document", { file_path: fileNvsTxt });
        const text11 = r11?.content?.[0]?.text || "";
        const pass11 = !r11?.isError && text11.includes(CONTENT_NVS_TXT);
        testResults.push({ id: "1.1", name: "nvs đọc tài liệu của chính mình", pass: pass11, out: text11.slice(0, 80) });
        console.log(`  [${pass11 ? "PASS" : "FAIL"}] 1.1 nvs đọc file chính chủ: ${pass11 ? "Thành công" : "Thất bại"}`);

        // 1.2 nva đọc doc_nva.txt của chính mình
        const r12 = await execToolRuntime(cookieNva, sessionNva, "read_document", { file_path: fileNvaTxt });
        const text12 = r12?.content?.[0]?.text || "";
        const pass12 = !r12?.isError && text12.includes(CONTENT_NVA_TXT);
        testResults.push({ id: "1.2", name: "nva đọc tài liệu của chính mình", pass: pass12, out: text12.slice(0, 80) });
        console.log(`  [${pass12 ? "PASS" : "FAIL"}] 1.2 nva đọc file chính chủ: ${pass12 ? "Thành công" : "Thất bại"}`);
    }

    // =========================================================================
    // TEST 2: USER BỊ TỪ CHỐI ĐỌC TÀI LIỆU CỦA USER KHÁC QUA READ_DOCUMENT
    // =========================================================================
    console.log("\n--- TEST 2: User bị từ chối đọc tài liệu của user khác ---");
    {
        // 2.1 nvs cố đọc doc_nva.txt của nva
        const r21 = await execToolRuntime(cookieNvs, sessionNvs, "read_document", { file_path: fileNvaTxt });
        const text21 = r21?.content?.[0]?.text || "";
        const pass21 = r21?.isError === true && text21.includes("Truy cập bị từ chối");
        testResults.push({ id: "2.1", name: "nvs bị từ chối đọc tài liệu của nva", pass: pass21, out: text21 });
        console.log(`  [${pass21 ? "PASS" : "FAIL"}] 2.1 nvs đọc tài liệu nva: ${pass21 ? "Đã bị từ chối (An toàn)" : "LỌT!"}`);

        // 2.2 nva cố đọc doc_nvs.txt của nvs
        const r22 = await execToolRuntime(cookieNva, sessionNva, "read_document", { file_path: fileNvsTxt });
        const text22 = r22?.content?.[0]?.text || "";
        const pass22 = r22?.isError === true && text22.includes("Truy cập bị từ chối");
        testResults.push({ id: "2.2", name: "nva bị từ chối đọc tài liệu của nvs", pass: pass22, out: text22 });
        console.log(`  [${pass22 ? "PASS" : "FAIL"}] 2.2 nva đọc tài liệu nvs: ${pass22 ? "Đã bị từ chối (An toàn)" : "LỌT!"}`);
    }

    // =========================================================================
    // TEST 3: SHELL/THỰC THI SCRIPT/RAW FS BỊ TỪ CHỐI (KỂ CẢ LỆNH VÔ HẠI VÀ ĐƯỜNG DẪN ĐỘNG)
    // =========================================================================
    console.log("\n--- TEST 3: Shell & Script bị từ chối ở tầng Runtime (Document-Only) ---");
    {
        // 3.1 nvs gọi lệnh shell vô hại: Get-Date
        const r31 = await execToolRuntime(cookieNvs, sessionNvs, "pwsh", { command: "Get-Date" });
        const text31 = r31?.content?.[0]?.text || "";
        const pass31 = r31?.isError === true && text31.includes("Chế độ Document-Only");
        testResults.push({ id: "3.1", name: "nvs gọi lệnh vô hại Get-Date bị chặn", pass: pass31, out: text31 });
        console.log(`  [${pass31 ? "PASS" : "FAIL"}] 3.1 nvs gọi Get-Date: ${pass31 ? "Bị chặn runtime (Document-Only)" : "Không chặn!"}`);

        // 3.2 nvs gọi lệnh shell vô hại: Write-Output 'Hello'
        const r32 = await execToolRuntime(cookieNvs, sessionNvs, "pwsh", { command: "Write-Output 'Hello Safe World'" });
        const text32 = r32?.content?.[0]?.text || "";
        const pass32 = r32?.isError === true && text32.includes("Chế độ Document-Only");
        testResults.push({ id: "3.2", name: "nvs gọi echo hello bị chặn", pass: pass32, out: text32 });
        console.log(`  [${pass32 ? "PASS" : "FAIL"}] 3.2 nvs gọi Write-Output: ${pass32 ? "Bị chặn runtime" : "Không chặn!"}`);

        // 3.3 nvs gọi chạy file script: powershell -File .\run.ps1
        const r33 = await execToolRuntime(cookieNvs, sessionNvs, "pwsh", { command: "powershell -File .\\run.ps1" });
        const text33 = r33?.content?.[0]?.text || "";
        const pass33 = r33?.isError === true && text33.includes("Chế độ Document-Only");
        testResults.push({ id: "3.3", name: "nvs chạy script bị chặn", pass: pass33, out: text33 });
        console.log(`  [${pass33 ? "PASS" : "FAIL"}] 3.3 nvs chạy script file: ${pass33 ? "Bị chặn runtime" : "Không chặn!"}`);

        // 3.4 nvs gọi lệnh đường dẫn tạo động (Join-Path hoặc nối chuỗi)
        const r34 = await execToolRuntime(cookieNvs, sessionNvs, "pwsh", {
            command: "$p = '..' + '\\' + 'nva'; Get-Content (Join-Path $p 'secret.txt')",
        });
        const text34 = r34?.content?.[0]?.text || "";
        const pass34 = r34?.isError === true && text34.includes("Chế độ Document-Only");
        testResults.push({ id: "3.4", name: "nvs gọi đường dẫn tạo động bị chặn", pass: pass34, out: text34 });
        console.log(`  [${pass34 ? "PASS" : "FAIL"}] 3.4 nvs gọi dynamic path: ${pass34 ? "Bị chặn runtime" : "Không chặn!"}`);

        // 3.5 nvs gọi raw filesystem tool 'read'
        const r35 = await execToolRuntime(cookieNvs, sessionNvs, "read", { file_path: "secret.txt" });
        const text35 = r35?.content?.[0]?.text || "";
        const pass35 = r35?.isError === true && text35.includes("Chế độ Document-Only");
        testResults.push({ id: "3.5", name: "nvs gọi raw fs tool 'read' bị chặn", pass: pass35, out: text35 });
        console.log(`  [${pass35 ? "PASS" : "FAIL"}] 3.5 nvs gọi tool 'read': ${pass35 ? "Bị chặn runtime" : "Không chặn!"}`);

        // 3.6 nva gọi pwsh (kiểm tra hai chiều nva)
        const r36 = await execToolRuntime(cookieNva, sessionNva, "pwsh", { command: "dir" });
        const text36 = r36?.content?.[0]?.text || "";
        const pass36 = r36?.isError === true && text36.includes("Chế độ Document-Only");
        testResults.push({ id: "3.6", name: "nva gọi shell bị chặn", pass: pass36, out: text36 });
        console.log(`  [${pass36 ? "PASS" : "FAIL"}] 3.6 nva gọi shell: ${pass36 ? "Bị chặn runtime" : "Không chặn!"}`);

        // 3.7 ADMIN không bị ảnh hưởng: Admin gọi pwsh thành công
        const r37 = await execToolRuntime(cookieAdmin, sessionAdmin, "pwsh", {
            command: "Write-Output 'ADMIN_EXECUTION_AUTHORIZED'",
            description: "Admin test execution",
        });
        const text37 = r37?.content?.[0]?.text || "";
        const pass37 = !r37?.isError && text37.includes("ADMIN_EXECUTION_AUTHORIZED");
        testResults.push({ id: "3.7", name: "Admin có quyền thực thi shell đầy đủ", pass: pass37, out: text37 });
        console.log(`  [${pass37 ? "PASS" : "FAIL"}] 3.7 Admin thực thi pwsh: ${pass37 ? "Thành công (Quyền admin bảo toàn)" : "Thất bại!"}`);
    }

    // =========================================================================
    // TEST 4: LOGIN, ĐỔI TÀI KHOẢN, F5 (USER-INIT) VÀ NEW SESSION VẪN HOẠT ĐỘNG
    // =========================================================================
    console.log("\n--- TEST 4: Luồng Auth, Đổi tài khoản, F5 và New Session ---");
    {
        // 4.1 F5 (user-init) cho nvs
        const resInitNvs = await fetch(`${LIVE_DSH_URL}/api/workspace/user-init`, {
            method: "POST",
            headers: { Cookie: cookieNvs },
        });
        const dataInitNvs = await resInitNvs.json();
        const pass41 = resInitNvs.status === 200 && dataInitNvs.success === true && !!dataInitNvs.sessionId;
        testResults.push({ id: "4.1", name: "user-init (F5) nvs hoạt động", pass: pass41, out: `sessionId: ${dataInitNvs.sessionId}` });
        console.log(`  [${pass41 ? "PASS" : "FAIL"}] 4.1 user-init nvs: ${pass41 ? "Thành công" : "Thất bại"}`);

        // 4.2 New Session cho nvs
        const resNewSessNvs = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({ workspaceId: "user-workspace-nvs", agentPreset: "standard" }),
        });
        const dataNewSessNvs = await resNewSessNvs.json();
        const pass42 = resNewSessNvs.status === 200 && (dataNewSessNvs.result?.value?.sessionId || dataNewSessNvs.sessionId);
        testResults.push({ id: "4.2", name: "Tạo New Session nvs thành công", pass: !!pass42, out: `newSession: ${pass42}` });
        console.log(`  [${pass42 ? "PASS" : "FAIL"}] 4.2 New Session nvs: ${pass42 ? "Thành công" : "Thất bại"}`);

        // 4.3 Đổi tài khoản: Login nva trên cùng kết nối
        const resReLoginNva = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "nva", password: userPassword }),
        });
        const cookieNewNva = resReLoginNva.headers.get("set-cookie")?.split(";")[0];
        const resInitNva = await fetch(`${LIVE_DSH_URL}/api/workspace/user-init`, {
            method: "POST",
            headers: { Cookie: cookieNewNva },
        });
        const dataInitNva = await resInitNva.json();
        const pass43 = resInitNva.status === 200 && dataInitNva.success === true && !!dataInitNva.sessionId;
        testResults.push({ id: "4.3", name: "Đổi tài khoản sang nva và user-init thành công", pass: pass43, out: `sessionId: ${dataInitNva.sessionId}` });
        console.log(`  [${pass43 ? "PASS" : "FAIL"}] 4.3 Đổi sang nva + user-init: ${pass43 ? "Thành công" : "Thất bại"}`);
    }

    console.log("\n======================================================================");
    console.log("                        BẢNG TỔNG HỢP KẾT QUẢ                         ");
    console.log("======================================================================");
    let allPassed = true;
    for (const r of testResults) {
        if (!r.pass) allPassed = false;
        console.log(`[${r.pass ? "PASS" : "FAIL"}] [${r.id}] ${r.name}`);
    }
    console.log(`\nKết luận: ${allPassed ? "TẤT CẢ CÁC BÀI TEST ĐÃ VƯỢT QUA HOÀN TOÀN!" : "CÓ BÀI TEST THẤT BẠI!"}`);
}

main().catch(err => {
    console.error("LỖI KIỂM THỬ:", err);
    process.exit(1);
});

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { initDatabase, recordAttachment, recordUserSession, createUser, getDb } from "../lib/db.js";

const LIVE_DSH_URL = "http://127.0.0.1:3088";
const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(PLUGIN_ROOT, "data", "users.db");
const DSH_HOME = "C:\\Users\\Admin\\.dsh-multiuser";
const ATT_DIR = path.join(DSH_HOME, "attachments", "v1", "files");
const WS_ROOT = path.join(PLUGIN_ROOT, "workspaces");

async function main() {
    console.log("======================================================================");
    console.log("   KIỂM THỬ RÀ SOÁT BẢO MẬT: CÁC ĐƯỜNG TRUY CẬP NGOÀI TOOLRUNTIME     ");
    console.log("   VÀ XÁC NHẬN CƠ CHẾ DENY-BY-DEFAULT CỦA GUARD TẦNG RUNTIME           ");
    console.log("======================================================================\n");

    const db = initDatabase(DB_PATH);
    const userPassword = process.env.TEST_USER_PASSWORD || "123456";

    // 1. Đăng nhập nvs và nva
    console.log("[BƯỚC 1] Xác thực và tạo session thật...");
    const resLoginNvs = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nvs", password: userPassword }),
    });
    assert.strictEqual(resLoginNvs.status, 200);
    const cookieNvs = resLoginNvs.headers.get("set-cookie")?.split(";")[0];

    const resLoginNva = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nva", password: userPassword }),
    });
    assert.strictEqual(resLoginNva.status, 200);
    const cookieNva = resLoginNva.headers.get("set-cookie")?.split(";")[0];

    // Session nvs
    const resSessNvs = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNvs },
        body: JSON.stringify({ workspaceId: "user-workspace-nvs", agentPreset: "standard" }),
    });
    const dataSessNvs = await resSessNvs.json();
    const sessionNvs = dataSessNvs.result?.value?.sessionId || dataSessNvs.sessionId;

    // Session nva
    const resSessNva = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieNva },
        body: JSON.stringify({ workspaceId: "user-workspace-nva", agentPreset: "standard" }),
    });
    const dataSessNva = await resSessNva.json();
    const sessionNva = dataSessNva.result?.value?.sessionId || dataSessNva.sessionId;

    console.log(`  -> nvs session: ${sessionNvs}`);
    console.log(`  -> nva session: ${sessionNva}`);

    // Chuẩn bị tài nguyên giả
    const dirAttNvs = path.join(ATT_DIR, "non_tool_nvs");
    const dirAttNva = path.join(ATT_DIR, "non_tool_nva");
    fs.mkdirSync(dirAttNvs, { recursive: true });
    fs.mkdirSync(dirAttNva, { recursive: true });

    const SECRET_TEXT_NVS = "BI_MAT_RIENG_TU_NVS_998877";
    const SECRET_TEXT_NVA = "BI_MAT_RIENG_TU_NVA_112233";

    const fileNvs = path.join(dirAttNvs, "private_nvs.txt");
    const fileNva = path.join(dirAttNva, "private_nva.txt");
    fs.writeFileSync(fileNvs, SECRET_TEXT_NVS, "utf8");
    fs.writeFileSync(fileNva, SECRET_TEXT_NVA, "utf8");

    recordAttachment({
        attachmentId: "sha256:private_att_nvs_x",
        fileName: "private_nvs.txt",
        fileSize: SECRET_TEXT_NVS.length,
        sessionId: sessionNvs,
        username: "nvs",
        filePath: fileNvs,
    });

    recordAttachment({
        attachmentId: "sha256:private_att_nva_y",
        fileName: "private_nva.txt",
        fileSize: SECRET_TEXT_NVA.length,
        sessionId: sessionNva,
        username: "nva",
        filePath: fileNva,
    });

    // File trong workspace
    const wsNvs = path.join(WS_ROOT, "nvs");
    const wsNva = path.join(WS_ROOT, "nva");
    fs.mkdirSync(wsNvs, { recursive: true });
    fs.mkdirSync(wsNva, { recursive: true });
    fs.writeFileSync(path.join(wsNvs, "ws_secret_nvs.txt"), "WS_SECRET_NVS_CONTENT", "utf8");
    fs.writeFileSync(path.join(wsNva, "ws_secret_nva.txt"), "WS_SECRET_NVA_CONTENT", "utf8");

    const report = [];

    // =========================================================================
    // PHẦN 1: RÀ SOÁT CÁC ĐƯỜNG TRUY CẬP REST / ATTACHMENT / WORKSPACE
    // =========================================================================
    console.log("\n--- PHẦN 1: RÀ SOÁT TRUY CẬP CHÉO QUA REST API ---");

    // 1.1 POST /api/document/read: nvs đọc tài liệu của nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/document/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({ file_path: fileNva, session_id: sessionNvs }),
        });
        const body = await res.json();
        const pass = (res.status === 403 || res.status === 400) && !JSON.stringify(body).includes(SECRET_TEXT_NVA);
        report.push({ id: "1.1", name: "nvs gọi /api/document/read đọc file của nva bị chặn", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.1 nvs gọi REST read file nva: ${pass ? "Bị chặn (Không lộ dữ liệu)" : "LỘ DỮ LIỆU!"}`);
    }

    // 1.2 POST /api/document/read: nva đọc tài liệu của nvs (chiều ngược lại)
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/document/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNva },
            body: JSON.stringify({ file_path: fileNvs, session_id: sessionNva }),
        });
        const body = await res.json();
        const pass = (res.status === 403 || res.status === 400) && !JSON.stringify(body).includes(SECRET_TEXT_NVS);
        report.push({ id: "1.2", name: "nva gọi /api/document/read đọc file của nvs bị chặn", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.2 nva gọi REST read file nvs: ${pass ? "Bị chặn (Không lộ dữ liệu)" : "LỘ DỮ LIỆU!"}`);
    }

    // 1.3 GET /api/document/attachments: nvs xem danh sách attachment
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/document/attachments`, {
            method: "GET",
            headers: { Cookie: cookieNvs },
        });
        const body = await res.json();
        const items = body.attachments || [];
        const hasNvaData = items.some(att => {
            const uname = att.username || "";
            const fname = att.file_name || att.fileName || "";
            const fpath = att.file_path || att.filePath || "";
            return uname === "nva" || fname === "private_nva.txt" || fpath.includes("non_tool_nva");
        });
        const pass = res.status === 200 && !hasNvaData;
        report.push({ id: "1.3", name: "nvs xem attachments không thấy metadata của nva", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.3 nvs liệt kê attachments: ${pass ? "Chỉ thấy của mình (Không lộ metadata nva)" : "LỘ METADATA NVA!"}`);
    }

    // 1.4 GET /api/document/attachments: nva xem danh sách attachment (chiều ngược lại)
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/document/attachments`, {
            method: "GET",
            headers: { Cookie: cookieNva },
        });
        const body = await res.json();
        const items = body.attachments || [];
        const hasNvsData = items.some(att => {
            const uname = att.username || "";
            const fname = att.file_name || att.fileName || "";
            const fpath = att.file_path || att.filePath || "";
            return uname === "nvs" || fname === "private_nvs.txt" || fpath.includes("non_tool_nvs");
        });
        const pass = res.status === 200 && !hasNvsData;
        report.push({ id: "1.4", name: "nva xem attachments không thấy metadata của nvs", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.4 nva liệt kê attachments: ${pass ? "Chỉ thấy của mình (Không lộ metadata nvs)" : "LỘ METADATA NVS!"}`);
    }

    // 1.5 POST /api/session/uploadFileBinary: nvs cố upload vào session của nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/session/uploadFileBinary?sessionId=${sessionNva}&name=exploit.txt`, {
            method: "POST",
            headers: { "Content-Type": "text/plain", Cookie: cookieNvs },
            body: "INTRUDER_CONTENT",
        });
        const pass = res.status === 403;
        report.push({ id: "1.5", name: "nvs upload file vào session của nva bị từ chối 403", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.5 nvs upload vào session nva: ${pass ? "Bị chặn 403" : "Không chặn!"}`);
    }

    // 1.6 POST /api/session/uploadFileBinary: nva cố upload vào session của nvs (chiều ngược lại)
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/session/uploadFileBinary?sessionId=${sessionNvs}&name=exploit.txt`, {
            method: "POST",
            headers: { "Content-Type": "text/plain", Cookie: cookieNva },
            body: "INTRUDER_CONTENT",
        });
        const pass = res.status === 403;
        report.push({ id: "1.6", name: "nva upload file vào session của nvs bị từ chối 403", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.6 nva upload vào session nvs: ${pass ? "Bị chặn 403" : "Không chặn!"}`);
    }

    // 1.7 GET /api/workspace/files?dir=../nva: nvs cố duyệt thư mục workspace nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/workspace/files?dir=../nva`, {
            method: "GET",
            headers: { Cookie: cookieNvs },
        });
        const pass = res.status === 403;
        report.push({ id: "1.7", name: "nvs path traversal thư mục /api/workspace/files bị 403", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.7 nvs duyệt thư mục workspace nva: ${pass ? "Bị chặn 403" : "Không chặn!"}`);
    }

    // 1.8 GET /api/workspace/file?path=../nva/ws_secret_nva.txt: nvs cố đọc file workspace nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/workspace/file?path=../nva/ws_secret_nva.txt`, {
            method: "GET",
            headers: { Cookie: cookieNvs },
        });
        const pass = res.status === 403;
        report.push({ id: "1.8", name: "nvs path traversal đọc file /api/workspace/file bị 403", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.8 nvs đọc file workspace nva: ${pass ? "Bị chặn 403" : "Không chặn!"}`);
    }

    // 1.9 POST /api/workspace/file: nvs cố ghi đè vào workspace nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/workspace/file`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({ path: "../nva/hacked.txt", content: "ATTACK" }),
        });
        const pass = res.status === 403;
        report.push({ id: "1.9", name: "nvs path traversal ghi file vào workspace nva bị 403", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.9 nvs ghi file workspace nva: ${pass ? "Bị chặn 403" : "Không chặn!"}`);
    }

    // 1.10 POST /api/session/create: nvs yêu cầu tạo session vào workspace nva
    {
        const res = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({
                payload: { args: { request: { workspaceId: "user-workspace-nva" } } },
            }),
        });
        const data = await res.json();
        const pass = data.result?.ok === false && data.result?.error?.code === "session/forbidden";
        report.push({ id: "1.10", name: "nvs tạo session vào workspace nva bị từ chối session/forbidden", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 1.10 nvs tạo session vào workspace nva: ${pass ? "Bị từ chối" : "Không chặn!"}`);
    }

    // =========================================================================
    // PHẦN 2: XÁC NHẬN CƠ CHẾ DENY-BY-DEFAULT CỦA GUARD TẦNG RUNTIME
    // =========================================================================
    console.log("\n--- PHẦN 2: XÁC NHẬN GUARD DENY-BY-DEFAULT ---");

    // Helper gọi trực tiếp Tool qua runtime
    async function callRuntimeDirect(cookie, payload) {
        const res = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        return json.result;
    }

    // 2.1 Thiếu sessionId -> Guard phải từ chối mặc định
    {
        // Gửi request với sessionId rỗng hoặc không có
        const res = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({ sessionId: "", toolName: "read_document", args: {} }),
        });
        const data = await res.json();
        const pass = res.status === 400 && data.ok === false;
        report.push({ id: "2.1", name: "Thiếu sessionId bị từ chối mặc định (HTTP 400)", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 2.1 Thiếu sessionId: ${pass ? "Từ chối mặc định" : "Không từ chối!"}`);
    }

    // 2.2 SessionId giả / không xác định được chủ sở hữu -> Bị từ chối mặc định
    {
        const fakeSess = "session-fake-unowned-999999";
        const res = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookieNvs },
            body: JSON.stringify({ sessionId: fakeSess, toolName: "read_document", args: {} }),
        });
        const data = await res.json();
        // Endpoint check: Session does not belong to authenticated user
        const pass = res.status === 403 && data.ok === false;
        report.push({ id: "2.2", name: "Session không thuộc về user / không chủ sở hữu bị từ chối mặc định (HTTP 403)", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 2.2 Session không có chủ: ${pass ? "Từ chối mặc định" : "Không từ chối!"}`);
    }

    // 2.3 Token/session cũ của tài khoản vừa bị vô hiệu hóa bị từ chối
    {
        const deactUser = "user_deact_test";
        const deactPwd = "password123";
        try {
            const { hashPassword } = await import("../lib/db.js");
            const h = hashPassword(deactPwd);
            db.exec(`INSERT OR REPLACE INTO users (username, password_hash, role, status, workspace_path) VALUES ('${deactUser}', '${h}', 'user', 'active', 'path');`);
        } catch (e) {}

        // Đăng nhập khi còn active -> Nhận token hợp lệ
        const resL = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: deactUser, password: deactPwd }),
        });
        const cookieDeact = resL.headers.get("set-cookie")?.split(";")[0];

        // Xác nhận token ban đầu hoạt động (200)
        const resBefore = await fetch(`${LIVE_DSH_URL}/api/auth/me`, {
            method: "GET",
            headers: { Cookie: cookieDeact },
        });
        assert.strictEqual(resBefore.status, 200, "Token ban đầu phải hoạt động");

        // Vô hiệu hóa tài khoản trong DB (status = 'disabled')
        db.exec(`UPDATE users SET status = 'disabled' WHERE username = '${deactUser}';`);

        // Dùng lại token cũ -> Phải bị từ chối 401
        const resAfter = await fetch(`${LIVE_DSH_URL}/api/auth/me`, {
            method: "GET",
            headers: { Cookie: cookieDeact },
        });
        const pass = resAfter.status === 401;

        report.push({ id: "2.3", name: "Token cũ của user vừa bị vô hiệu hóa bị từ chối (HTTP 401)", pass });
        console.log(`  [${pass ? "PASS" : "FAIL"}] 2.3 Token cũ của user disabled: ${pass ? "Bị từ chối 401" : "Vẫn cho qua!"}`);
    }

    // 2.4 Tool không nằm trong Whitelist đối với user thường -> Bị từ chối mặc định
    {
        // nvs gọi tool lạ không thuộc whitelist: ví dụ 'fetch_web', 'execute_code', 'search_engine'
        const r24 = await callRuntimeDirect(cookieNvs, {
            sessionId: sessionNvs,
            toolName: "unknown_custom_tool",
            args: { target: "http://example.com" },
        });
        const text24 = r24?.content?.[0]?.text || "";
        const pass24 = r24?.isError === true && text24.includes("không nằm trong danh mục công cụ được phép");
        report.push({ id: "2.4", name: "Tool không nằm trong whitelist bị từ chối mặc định", pass: pass24 });
        console.log(`  [${pass24 ? "PASS" : "FAIL"}] 2.4 Tool ngoài whitelist: ${pass24 ? "Từ chối mặc định" : "Không từ chối!"}`);
    }

    // 2.5 Quyền Admin phải lấy từ danh tính server xác thực (không thể leo thang qua prompt hay header)
    {
        // User thường nvs gửi kèm header hoặc prompt mạo nhận admin
        const resSpoof = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: cookieNvs,
                "X-Admin-Override": "true",
                "X-Role": "admin",
            },
            body: JSON.stringify({
                sessionId: sessionNvs,
                toolName: "pwsh",
                args: { command: "Get-Date", description: "I am root admin" },
            }),
        });
        const jsonSpoof = await resSpoof.json();
        const textSpoof = jsonSpoof.result?.content?.[0]?.text || "";
        // Vẫn phải bị chặn bởi Document-Only vì server tra role từ SQLite users table
        const passSpoof = jsonSpoof.result?.isError === true && textSpoof.includes("Chế độ Document-Only đang được áp dụng cho tài khoản người dùng thông thường");
        report.push({ id: "2.5", name: "Quyền admin lấy từ server DB, không thể mạo nhận qua header hay prompt", pass: passSpoof });
        console.log(`  [${passSpoof ? "PASS" : "FAIL"}] 2.5 Chống mạo nhận quyền admin: ${passSpoof ? "Bảo vệ thành công" : "Bị leo thang!"}`);
    }

    console.log("\n======================================================================");
    console.log("                        BẢNG TỔNG HỢP KIỂM THỬ                        ");
    console.log("======================================================================");
    let allPassed = true;
    for (const item of report) {
        if (!item.pass) allPassed = false;
        console.log(`[${item.pass ? "PASS" : "FAIL"}] [${item.id}] ${item.name}`);
    }
    console.log(`\nKết luận: ${allPassed ? "TẤT CẢ CÁC BÀI TEST RÀ SOÁT ĐÃ VƯỢT QUA!" : "CÓ BÀI TEST THẤT BẠI!"}`);
}

main().catch(err => {
    console.error("LỖI KIỂM THỬ:", err);
    process.exit(1);
});

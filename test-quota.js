import http from "node:http";
import { apply } from "./lib/index.js";

class MockWebServer {
    constructor() {
        this.routes = [];
        this.server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
            const matched = this.routes.find((r) => {
                if (r.kind === "exact") return r.path === url.pathname;
                if (r.kind === "prefix") return url.pathname.startsWith(r.path);
                return false;
            });

            if (matched) {
                matched.handler(req, res);
            } else {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not Found" }));
            }
        });
    }

    register(route) {
        this.routes.push(route);
    }

    listen(port) {
        return new Promise((resolve) => {
            this.server.listen(port, "127.0.0.1", () => resolve());
        });
    }

    close() {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
}

async function request(port, method, path, data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const postData = data ? JSON.stringify(data) : null;
        const reqHeaders = { ...headers };
        if (postData) {
            reqHeaders["Content-Type"] = "application/json";
            reqHeaders["Content-Length"] = Buffer.byteLength(postData);
        }

        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: reqHeaders,
            },
            (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => {
                    let json = null;
                    try {
                        json = JSON.parse(body);
                    } catch {
                        json = body;
                    }
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        data: json,
                    });
                });
            },
        );

        req.on("error", reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function runQuotaTests() {
    console.log("\n--- BẮT ĐẦU TEST TOÀN DIỆN TOKEN QUOTA & ADMIN MANAGEMENT ---");
    const webServer = new MockWebServer();
    const TEST_PORT = 49154;
    await webServer.listen(TEST_PORT);

    const mockCtx = {
        webServer,
        provide: (name, obj) => {
            mockCtx[name] = obj;
        },
    };

    apply(mockCtx);

    try {
        // 0. Verify Phase 4 Status
        console.log("\n[0] Testing GET /api/user-manager/status...");
        const statusRes = await request(TEST_PORT, "GET", "/api/user-manager/status");
        console.log("Status code:", statusRes.status);
        console.log("Response:", statusRes.data);
        if (statusRes.status !== 200 || !statusRes.data.quotaMetering) {
            throw new Error("Phase 4 status assertion failed");
        }

        // Register Normal User and Login
        const normalUser = `user_${Date.now().toString().slice(-4)}`;
        console.log(`\nRegistering user '${normalUser}'...`);
        await request(TEST_PORT, "POST", "/api/auth/register", { username: normalUser, password: "password123" });

        // Approve user
        const { approveUser } = await import("./lib/db.js");
        approveUser(normalUser);

        const userLoginRes = await request(TEST_PORT, "POST", "/api/auth/login", {
            username: normalUser,
            password: "password123",
        });
        const userCookie = userLoginRes.headers["set-cookie"][0].split(";")[0];

        // Login Admin
        console.log(`Logging in admin...`);
        const adminLoginRes = await request(TEST_PORT, "POST", "/api/auth/login", {
            username: "admin",
            password: "admin123",
        });
        const adminCookie = adminLoginRes.headers["set-cookie"][0].split(";")[0];

        // a) User xem quota ban đầu: tokens_used: 0, remaining: 100000
        console.log(`\n[A] User '${normalUser}' checking initial quota...`);
        const quotaRes1 = await request(TEST_PORT, "GET", "/api/user/quota", null, { Cookie: userCookie });
        console.log("Status code:", quotaRes1.status);
        console.log("Initial Quota:", quotaRes1.data);
        if (quotaRes1.status !== 200 || quotaRes1.data.tokens_used !== 0 || quotaRes1.data.remaining !== 100000) {
            throw new Error(`Initial quota mismatch. Expected used=0, remaining=100000`);
        }

        // b) User tiêu thụ 20,000 token -> tokens_used: 20000, remaining: 80000
        console.log(`\n[B] User '${normalUser}' consuming 20,000 tokens...`);
        const consumeRes1 = await request(
            TEST_PORT,
            "POST",
            "/api/user/consume",
            { tokens: 20000, action: "chat_agent" },
            { Cookie: userCookie },
        );
        console.log("Status code:", consumeRes1.status);
        console.log("Consume response:", consumeRes1.data);
        if (
            consumeRes1.status !== 200 ||
            consumeRes1.data.tokens_used !== 20000 ||
            consumeRes1.data.remaining !== 80000
        ) {
            throw new Error(`Consume 20k tokens failed. Expected used=20000, remaining=80000`);
        }

        // c) User cố tình tiêu thụ 90,000 token (vượt quá 80,000 còn lại) -> Bị từ chối HTTP 402 ("Quota exceeded")
        console.log(`\n[C] User '${normalUser}' attempting to consume 90,000 tokens (remaining is only 80,000)...`);
        const consumeResExcess = await request(
            TEST_PORT,
            "POST",
            "/api/user/consume",
            { tokens: 90000, action: "heavy_reasoning" },
            { Cookie: userCookie },
        );
        console.log("Status code:", consumeResExcess.status);
        console.log("Rejection response:", consumeResExcess.data);
        if (consumeResExcess.status !== 402) {
            throw new Error(`Expected HTTP 402 Quota Exceeded but got: ${consumeResExcess.status}`);
        }

        // Kiểm tra lại xem số token đã dùng có giữ nguyên ở 20,000 không
        const quotaResCheck = await request(TEST_PORT, "GET", "/api/user/quota", null, { Cookie: userCookie });
        console.log("Quota after failed attempt:", quotaResCheck.data);
        if (quotaResCheck.data.tokens_used !== 20000 || quotaResCheck.data.remaining !== 80000) {
            throw new Error(`State was modified after failed transaction!`);
        }

        // d) User thường cố tình gọi API admin -> Bị chặn 403 Forbidden
        console.log(`\n[D] Normal user '${normalUser}' attempting to call GET /api/admin/users (expecting 403)...`);
        const adminForbidden1 = await request(TEST_PORT, "GET", "/api/admin/users", null, { Cookie: userCookie });
        console.log("Status code:", adminForbidden1.status);
        console.log("Response:", adminForbidden1.data);
        if (adminForbidden1.status !== 403) {
            throw new Error(
                `Admin route GET /api/admin/users not blocked for normal user! Got: ${adminForbidden1.status}`,
            );
        }

        console.log(`\n[D.2] Normal user '${normalUser}' attempting to call POST /api/admin/quota (expecting 403)...`);
        const adminForbidden2 = await request(
            TEST_PORT,
            "POST",
            "/api/admin/quota",
            { username: normalUser, quota: 999999 },
            { Cookie: userCookie },
        );
        console.log("Status code:", adminForbidden2.status);
        console.log("Response:", adminForbidden2.data);
        if (adminForbidden2.status !== 403) {
            throw new Error(
                `Admin route POST /api/admin/quota not blocked for normal user! Got: ${adminForbidden2.status}`,
            );
        }

        // e) Admin đăng nhập, gọi POST /api/admin/quota nâng hạn mức cho user lên 500,000 token -> 200 OK
        console.log(`\n[E] Admin increasing quota for '${normalUser}' to 500,000 tokens...`);
        const adminIncreaseRes = await request(
            TEST_PORT,
            "POST",
            "/api/admin/quota",
            { username: normalUser, quota: 500000 },
            { Cookie: adminCookie },
        );
        console.log("Status code:", adminIncreaseRes.status);
        console.log("Admin response:", adminIncreaseRes.data);
        if (adminIncreaseRes.status !== 200 || adminIncreaseRes.data.user.token_quota !== 500000) {
            throw new Error(`Admin quota increase failed`);
        }

        // e.2) Admin kiểm tra danh sách user
        console.log(`\n[E.2] Admin calling GET /api/admin/users...`);
        const adminListUsersRes = await request(TEST_PORT, "GET", "/api/admin/users", null, { Cookie: adminCookie });
        console.log("Status code:", adminListUsersRes.status);
        console.log(`Total users found: ${adminListUsersRes.data.users.length}`);
        const foundUserInList = adminListUsersRes.data.users.find((u) => u.username === normalUser);
        if (!foundUserInList || foundUserInList.token_quota !== 500000) {
            throw new Error(`User not listed with updated quota in admin list`);
        }

        // f) User thử tiêu thụ tiếp 90,000 token -> Lần này thành công rực rỡ vì quota đã được nâng!
        console.log(`\n[F] User '${normalUser}' re-attempting to consume 90,000 tokens after quota increase...`);
        const consumeResSuccess = await request(
            TEST_PORT,
            "POST",
            "/api/user/consume",
            { tokens: 90000, action: "heavy_reasoning" },
            { Cookie: userCookie },
        );
        console.log("Status code:", consumeResSuccess.status);
        console.log("Consume response:", consumeResSuccess.data);
        // 20000 đã dùng + 90000 = 110000 tokens_used, remaining = 500000 - 110000 = 390000
        if (
            consumeResSuccess.status !== 200 ||
            consumeResSuccess.data.tokens_used !== 110000 ||
            consumeResSuccess.data.remaining !== 390000
        ) {
            throw new Error(`Second consumption failed. Expected used=110000, remaining=390000`);
        }

        // g) Admin reset usage về 0
        console.log(`\n[G] Admin resetting usage for '${normalUser}'...`);
        const adminResetRes = await request(
            TEST_PORT,
            "POST",
            "/api/admin/reset-usage",
            { username: normalUser },
            { Cookie: adminCookie },
        );
        console.log("Status code:", adminResetRes.status);
        console.log("Reset response:", adminResetRes.data);
        if (adminResetRes.status !== 200 || adminResetRes.data.user.tokens_used !== 0) {
            throw new Error(`Reset usage failed`);
        }

        console.log("\n========================================================================");
        console.log("🎉 TẤT CẢ TEST CASES GIAI ĐOẠN 4 (TOKEN QUOTA & ADMIN) ĐỀU PASS 100%!");
        console.log("========================================================================\n");
    } finally {
        await webServer.close();
    }
}

runQuotaTests().catch((err) => {
    console.error("Quota test suite failed:", err);
    process.exit(1);
});

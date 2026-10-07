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

async function runWorkspaceTests() {
    console.log("\n--- BẮT ĐẦU TEST TOÀN DIỆN WORKSPACE & SANDBOX ISOLATION ---");
    const webServer = new MockWebServer();
    const TEST_PORT = 49153;
    await webServer.listen(TEST_PORT);

    const mockCtx = {
        webServer,
        provide: (name, obj) => {
            mockCtx[name] = obj;
        },
    };

    apply(mockCtx);

    try {
        // 0. Verify Phase 3 Status
        console.log("\n[0] Testing GET /api/user-manager/status...");
        const statusRes = await request(TEST_PORT, "GET", "/api/user-manager/status");
        console.log("Status code:", statusRes.status);
        console.log("Response:", statusRes.data);
        if (statusRes.status !== 200 || !statusRes.data.workspaceIsolation) {
            throw new Error("Phase 3 status assertion failed");
        }

        // a) Người dùng chưa đăng nhập gọi API workspace -> Nhận 401 Unauthorized
        console.log("\n[A] Testing Unauthenticated access to /api/workspace/files (expecting 401)...");
        const unauthFilesRes = await request(TEST_PORT, "GET", "/api/workspace/files");
        console.log("Status code:", unauthFilesRes.status);
        console.log("Response:", unauthFilesRes.data);
        if (unauthFilesRes.status !== 401) {
            throw new Error(`Expected 401 but got ${unauthFilesRes.status}`);
        }

        console.log("\n[A.2] Testing Unauthenticated access to POST /api/workspace/file (expecting 401)...");
        const unauthPostRes = await request(TEST_PORT, "POST", "/api/workspace/file", {
            path: "test.txt",
            content: "hello",
        });
        console.log("Status code:", unauthPostRes.status);
        if (unauthPostRes.status !== 401) {
            throw new Error(`Expected 401 but got ${unauthPostRes.status}`);
        }

        // Register User A & User B
        const userA = `alice_${Date.now().toString().slice(-4)}`;
        const userB = `bob_${Date.now().toString().slice(-4)}`;

        console.log(`\nRegistering User A: ${userA} and User B: ${userB}...`);
        await request(TEST_PORT, "POST", "/api/auth/register", { username: userA, password: "password123" });
        await request(TEST_PORT, "POST", "/api/auth/register", { username: userB, password: "password123" });

        // Approve both users
        const { approveUser } = await import("./lib/db.js");
        approveUser(userA);
        approveUser(userB);

        // Login User A
        const loginARes = await request(TEST_PORT, "POST", "/api/auth/login", {
            username: userA,
            password: "password123",
        });
        const tokenA = loginARes.data.token;
        const cookieA = loginARes.headers["set-cookie"][0].split(";")[0];

        // Login User B
        const loginBRes = await request(TEST_PORT, "POST", "/api/auth/login", {
            username: userB,
            password: "password123",
        });
        const tokenB = loginBRes.data.token;
        const cookieB = loginBRes.headers["set-cookie"][0].split(";")[0];

        // b) User A đăng nhập, ghi file project/hello.txt -> Thành công (201)
        console.log(`\n[B] User A (${userA}) writing file "project/hello.txt"...`);
        const fileContentA = "Hello World from Alice Workspace Secret Project!";
        const writeARes = await request(
            TEST_PORT,
            "POST",
            "/api/workspace/file",
            {
                path: "project/hello.txt",
                content: fileContentA,
            },
            { Cookie: cookieA },
        );
        console.log("Status code:", writeARes.status);
        console.log("Write response:", writeARes.data);
        if (writeARes.status !== 201) {
            throw new Error(`Failed to write file as User A, status: ${writeARes.status}`);
        }

        // List files for User A
        console.log(`\n[B.2] User A listing files...`);
        const listARes = await request(TEST_PORT, "GET", "/api/workspace/files", null, { Cookie: cookieA });
        console.log("List files response:", JSON.stringify(listARes.data, null, 2));
        if (listARes.status !== 200 || listARes.data.files.length === 0) {
            throw new Error("User A list files failed");
        }

        // c) User A đọc lại file project/hello.txt -> Nhận đúng nội dung (200)
        console.log(`\n[C] User A (${userA}) reading file "project/hello.txt"...`);
        const readARes = await request(TEST_PORT, "GET", "/api/workspace/file?path=project/hello.txt", null, {
            Cookie: cookieA,
        });
        console.log("Status code:", readARes.status);
        console.log("Read content:", readARes.data);
        if (readARes.status !== 200 || readARes.data.content !== fileContentA) {
            throw new Error(`User A read file content mismatch`);
        }

        // d) Tấn công Path Traversal: User A cố tình gửi path: "../../etc/passwd" hoặc "../../data/users.db" -> 403 Forbidden
        console.log('\n[D] Testing Path Traversal attack 1: "../../data/users.db" (expecting 403 Forbidden)...');
        const attack1Res = await request(TEST_PORT, "GET", "/api/workspace/file?path=../../data/users.db", null, {
            Cookie: cookieA,
        });
        console.log("Status code:", attack1Res.status);
        console.log("Response:", attack1Res.data);
        if (attack1Res.status !== 403) {
            throw new Error(`Path traversal attack 1 not blocked with 403! Got: ${attack1Res.status}`);
        }

        console.log(
            '\n[D.2] Testing Path Traversal attack 2: POST with path "project/../../../etc/shadow" (expecting 403)...',
        );
        const attack2Res = await request(
            TEST_PORT,
            "POST",
            "/api/workspace/file",
            {
                path: "project/../../../etc/shadow",
                content: "malicious",
            },
            { Cookie: cookieA },
        );
        console.log("Status code:", attack2Res.status);
        console.log("Response:", attack2Res.data);
        if (attack2Res.status !== 403) {
            throw new Error(`Path traversal attack 2 not blocked with 403! Got: ${attack2Res.status}`);
        }

        console.log(
            '\n[D.3] Testing Path Traversal attack 3: Absolute Windows path "C:/Windows/System32/calc.exe" (expecting 403)...',
        );
        const attack3Res = await request(
            TEST_PORT,
            "GET",
            "/api/workspace/file?path=C:/Windows/System32/calc.exe",
            null,
            {
                Cookie: cookieA,
            },
        );
        console.log("Status code:", attack3Res.status);
        console.log("Response:", attack3Res.data);
        if (attack3Res.status !== 403) {
            throw new Error(`Absolute path traversal attack 3 not blocked with 403! Got: ${attack3Res.status}`);
        }

        // e) Phân lập User (Cross-user Isolation): User B đăng nhập, xem file project/hello.txt trong workspace của mình -> Nhận 404
        console.log(`\n[E] Testing Cross-User Isolation: User B (${userB}) trying to read "project/hello.txt"...`);
        const readBRes = await request(TEST_PORT, "GET", "/api/workspace/file?path=project/hello.txt", null, {
            Cookie: cookieB,
        });
        console.log("Status code:", readBRes.status);
        console.log("Response for User B:", readBRes.data);
        if (readBRes.status !== 404) {
            throw new Error(`Cross-user isolation broken! User B got: ${readBRes.status}`);
        }

        console.log(`\n[E.2] User B trying path traversal to read User A workspace "../${userA}/project/hello.txt"...`);
        const attackCrossUserRes = await request(
            TEST_PORT,
            "GET",
            `/api/workspace/file?path=../${userA}/project/hello.txt`,
            null,
            {
                Cookie: cookieB,
            },
        );
        console.log("Status code:", attackCrossUserRes.status);
        console.log("Response:", attackCrossUserRes.data);
        if (attackCrossUserRes.status !== 403) {
            throw new Error(`Cross-user traversal not blocked with 403! Got: ${attackCrossUserRes.status}`);
        }

        console.log("\n================================================================");
        console.log("🎉 TẤT CẢ TEST CASES GIAI ĐOẠN 3 (WORKSPACE & SANDBOX) ĐỀU PASS 100%!");
        console.log("================================================================\n");
    } finally {
        await webServer.close();
    }
}

runWorkspaceTests().catch((err) => {
    console.error("Workspace test suite failed:", err);
    process.exit(1);
});

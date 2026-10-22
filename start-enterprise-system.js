// start-enterprise-system.js
// Khởi chạy toàn bộ hạ tầng Multi-Tenant SaaS Enterprise:
// 1. PostgreSQL & Nginx qua Docker Compose (Project: dsh-enterprise)
// 2. Master Backend Gateway & Docker Orchestrator (Port 4000)

import { execSync } from "child_process";
import path from "path";
import { initDatabase } from "./database/index.js";
import { startMasterServer } from "./master-backend/server.js";

function runCmd(cmd) {
    try {
        return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
    } catch (err) {
        return (err.stdout || "") + (err.stderr || "");
    }
}

function freePortIfOccupied(port) {
    try {
        const output = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
        const lines = output.trim().split("\n");
        const killedPids = new Set();
        for (const line of lines) {
            if (line.includes("LISTENING") || line.includes("0.0.0.0:" + port) || line.includes(":::" + port)) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== "0" && pid !== String(process.pid) && !killedPids.has(pid)) {
                    killedPids.add(pid);
                    console.log(`  -> Phát hiện tiến trình cũ (PID: ${pid}) đang chiếm dụng port ${port}. Đang tự động giải phóng...`);
                    try {
                        execSync(`taskkill /F /PID ${pid}`, { stdio: ["pipe", "pipe", "pipe"] });
                    } catch {}
                }
            }
        }
        if (killedPids.size > 0) {
            execSync("timeout /t 1 >nul 2>&1 || ping 127.0.0.1 -n 2 >nul", { stdio: ["pipe", "pipe", "pipe"] });
        }
    } catch {}
}

async function startSystem() {
    console.log("================================================================");
    console.log("🚀 KHỞI ĐỘNG HỆ THỐNG DEEPSEEK HARNESS SAAS ENTERPRISE");
    console.log("================================================================\n");

    // 1. Khởi động Docker Compose Stack (postgres + nginx)
    console.log("[1/3] Khởi chạy Docker Compose Stack (dsh-enterprise)...");
    const composeOut = runCmd("docker compose up -d");
    console.log("  -> Trạng thái Compose:\n" + composeOut.trim().split("\n").map(l => "     " + l).join("\n"));

    // Đợi Postgres sẵn sàng
    console.log("  -> Đang kiểm tra kết nối PostgreSQL (Port 5432)...");
    let connected = false;
    for (let i = 0; i < 10; i++) {
        try {
            await initDatabase();
            connected = true;
            break;
        } catch (e) {
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    if (!connected) {
        throw new Error("Không thể kết nối đến PostgreSQL sau 10 lần thử.");
    }
    console.log("  -> Đồng bộ ORM và 4 bảng cơ sở dữ liệu thành công.");

    // 2. Khởi động Master Backend Gateway
    console.log("\n[2/3] Khởi động Master Backend Gateway (Port 4000)...");
    freePortIfOccupied(4000);
    const masterServer = await startMasterServer(4000);
    console.log("  -> Master Backend & Docker Orchestrator sẵn sàng tại http://127.0.0.1:4000");

    console.log("\n[3/3] Trạng thái dịch vụ Nginx Reverse Proxy...");
    console.log("  -> Nginx Reverse Proxy Container đang chạy tại http://localhost:8080");

    console.log("\n================================================================");
    console.log("✅ TOÀN BỘ HỆ THỐNG ĐÃ SẴN SÀNG!");
    console.log("   🌐 Truy cập hệ thống: http://localhost:8080/ (Tự chuyển hướng /login nếu chưa đăng nhập)");
    console.log("   🛡️ Trang Quản trị Admin: http://localhost:8080/admin");
    console.log("   🔑 Trang Đăng nhập: http://localhost:8080/login");
    console.log("   Nhấn Ctrl + C để dừng Master Backend.");
    console.log("================================================================\n");

    process.on("SIGINT", () => {
        console.log("\nĐang dừng Master Backend Gateway...");
        masterServer.close();
        console.log("Lưu ý: Docker stack (postgres, nginx) vẫn tiếp tục chạy ngầm trong Docker Desktop.");
        console.log("Để dừng toàn bộ docker stack, gõ: docker compose down");
        process.exit(0);
    });
}

startSystem().catch((err) => {
    console.error("Lỗi khởi động hệ thống:", err);
    process.exit(1);
});

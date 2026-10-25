// start-enterprise-system.js
// Khởi chạy toàn bộ hạ tầng Multi-Tenant SaaS Lite Enterprise:
// Main Gateway (Port 12345) chứa SQLite + Reverse Proxy + Docker Orchestrator

import { execSync } from "child_process";
import { initDatabase } from "./database/index.js";
import { startMasterServer } from "./master-backend/server.js";

function runCmd(cmd) {
    try {
        return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" });
    } catch (err) {
        return (err.stdout || "") + (err.stderr || "");
    }
}

async function startSystem() {
    console.log("================================================================");
    console.log("🚀 KHỞI ĐỘNG HỆ THỐNG DEEPSEEK HARNESS SAAS (LITE ENTERPRISE)");
    console.log("================================================================\n");

    console.log("[1/2] Kiểm tra kết nối cơ sở dữ liệu SQLite...");
    await initDatabase();
    console.log("  -> Kết nối SQLite và 4 bảng cơ sở dữ liệu thành công.");

    console.log("\n[2/2] Khởi chạy Docker Compose Main Gateway (Port 12345)...");
    const composeOut = runCmd("docker compose up -d main-gateway");
    console.log("  -> Trạng thái Compose:\n" + composeOut.trim().split("\n").map(l => "     " + l).join("\n"));

    console.log("\n================================================================");
    console.log("✅ HỆ THỐNG LITE ENTERPRISE ĐÃ SẴN SÀNG!");
    console.log("   🌐 Cổng duy nhất (Main Gateway): http://localhost:12345");
    console.log("   🔑 Trang Đăng nhập: http://localhost:12345/login");
    console.log("   🛡️ Quản trị Admin: http://localhost:12345/admin");
    console.log("   ⚡ User Sandbox: Tự động spawn container riêng khi người dùng đăng nhập");
    console.log("================================================================\n");
}

startSystem().catch((err) => {
    console.error("Lỗi khởi động hệ thống:", err);
    process.exit(1);
});

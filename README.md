# dsh-plugin-user-manager

Plugin for **DeepSeek Harness (DSH)** providing multi-user authentication, SQLite persistence, workspace isolation, security sandboxing, token quota metering, and **Native DSH UI Integration** (Guest Mode & Admin Approval Flow).

## 🚀 Features

- **Cordis Plugin Architecture**: Seamlessly integrates into DSH runtime via `cordis.patch.yml`.
- **Native DSH UI Integration** (`ctx.webServer.tapIndex`):
  - Injects directly into the main DSH UI (`http://127.0.0.1:3088/`), no external port or URL needed.
  - **Guest Mode (Ephemeral/Incognito)**: Unauthenticated users can chat freely, but are notified that session history is not permanently saved.
  - **Dark Glassmorphism Modal**: Modern Login & Register modal matching DSH design language.
  - **Admin Button on Menu**: Admin user gets a floating `👑 Quản lý tài khoản` button.
  - **Slide-out Admin Panel**: Tabs for "Chờ duyệt" (Quick Approve/Reject) and "Tất cả thành viên" (Quota editor & Token reset), with a `⬅️ Quay lại DSH` return button.
- **Account Approval Flow**:
  - New users register with status `pending`.
  - Pending users are blocked from logging in with HTTP 403 until approved by Admin.
  - Admin can approve (`active`) or reject (`rejected`) accounts with one click.
- **Authentication System**:
  - Built-in SQLite database using Node.js native `node:sqlite` (`DatabaseSync` in Node v26+).
  - Secure password hashing with `node:crypto` (`scryptSync` + salt + `timingSafeEqual`).
  - Session management with HttpOnly cookies and Bearer tokens.
  - Pre-seeded default admin account (`admin` / `admin123`).
  - REST endpoints:
    - `POST /api/auth/register`
    - `POST /api/auth/login`
    - `GET /api/auth/me`
    - `POST /api/auth/logout`
    - `GET /api/admin/pending-users` (Admin only)
    - `POST /api/admin/approve-user` (Admin only)
    - `POST /api/admin/reject-user` (Admin only)
- **Workspace Isolation & Security Sandbox**:
  - Independent workspace for each user at `workspaces/<username>`.
  - Multi-layer defense against **Path Traversal Attacks** (blocks null bytes, `../`, and absolute path breakouts).
  - Complete cross-user isolation.
  - REST endpoints:
    - `GET /api/workspace/files`
    - `GET /api/workspace/file?path=...`
    - `POST /api/workspace/file`
- **Token Quota & Usage Metering**:
  - Transactional token consumption with `token_logs` SQLite table.
  - Atomic validation rejecting token overrun with HTTP 402 ("Quota exceeded").
  - Admin management endpoints for user listing, quota modification, and token reset.
  - REST endpoints:
    - `GET /api/user/quota`
    - `POST /api/user/consume`
    - `GET /api/admin/users` (Admin only)
    - `POST /api/admin/quota` (Admin only)
    - `POST /api/admin/reset-usage` (Admin only)

## 📦 Installation & Setup

Link the plugin into your DSH web profile:

```powershell
dsh plugin --profile web link "c:\path\to\User Management"
```

Start DeepSeek Harness:
```powershell
dsh web
```
Then visit `http://127.0.0.1:3088/` directly!

## 🧪 Testing

Run automated tests:

```powershell
# 1. Test Auth & Database
node test-auth.js

# 2. Test Workspace Sandbox & Path Traversal Defense
node test-workspace.js

# 3. Test Token Quota & Admin Management
node test-quota.js

# 4. Test Native UI Injection & Approval Flow
node test-native-approval.js
```

## 📄 License

MIT

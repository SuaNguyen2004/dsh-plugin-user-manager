# dsh-plugin-user-manager

Plugin for **DeepSeek Harness (DSH)** providing multi-user authentication, SQLite persistence, workspace isolation, security sandboxing, and token quota management.

## 🚀 Features

- **Cordis Plugin Architecture**: Seamlessly integrates into DSH runtime via `cordis.patch.yml`.
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
- **Workspace Isolation & Security Sandbox**:
  - Independent workspace for each user at `workspaces/<username>`.
  - Multi-layer defense against **Path Traversal Attacks** (blocks null bytes, `../`, and absolute path breakouts).
  - Complete cross-user isolation.
  - REST endpoints:
    - `GET /api/workspace/files`
    - `GET /api/workspace/file?path=...`
    - `POST /api/workspace/file`

## 📦 Installation & Setup

Link the plugin into your DSH web profile:

```powershell
dsh plugin --profile web link "c:\path\to\User Management"
```

## 🧪 Testing

Run automated tests:

```powershell
# Test Auth & Database
node test-auth.js

# Test Workspace Sandbox & Path Traversal Defense
node test-workspace.js
```

## 📄 License

MIT

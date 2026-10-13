# dsh-plugin-user-manager

Plugin for **DeepSeek Harness (DSH)** providing multi-user authentication, SQLite persistence, workspace isolation, security sandboxing, Document-Only mode, and **Native DSH UI Integration** (Guest Mode & Admin Approval Flow).

## 🚀 Features

- **Cordis Plugin Architecture**: Seamlessly integrates into DSH runtime via `cordis.patch.yml`.
- **Native DSH UI Integration** (`ctx.webServer.tapIndex`):
  - Injects directly into the main DSH UI (`http://127.0.0.1:3088/`), no external port or URL needed.
  - **Guest Mode (Ephemeral/Incognito)**: Unauthenticated users can chat freely, but are notified that session history is not permanently saved.
  - **Dark Glassmorphism Modal**: Modern Login & Register modal matching DSH design language.
  - **Admin Button on Menu**: Admin user gets a floating `👑 Quản lý tài khoản` button.
  - **Slide-out Admin Panel**: Tabs for "Chờ duyệt" (Quick Approve/Reject) and "Tất cả thành viên" (User list), with a `⬅️ Quay lại DSH` return button.
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
    - `GET /api/admin/users` (Admin only)
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
- **API Key Pooling & 429 Auto-Recovery (Xoay vòng đa key & Tự động phục hồi)**:
  - Cho phép Admin cấu hình danh sách nhiều API Key cho mỗi Provider (dán nhiều dòng từ các tài khoản độc lập).
  - Phân bổ tải thông minh (Round-Robin) giữa các key còn khỏe mạnh.
  - Hook sâu vào sự kiện `agent/request-error` của DSH: tự động phát hiện lỗi 429 (Rate Limit / Quota Exceeded), đưa key đó vào Cooldown 60 giây và xoay ngay sang key kế tiếp.
  - Phát lệnh `{ kind: 'retry' }` tức thì cho agent loop của DSH $\rightarrow$ người dùng không bị báo lỗi đỏ hay ngắt quãng khi chat/vibe-coding.
  - Tự động phục hồi trạng thái `active` cho key khi hết hạn phạt Cooldown.
  - Giao diện trực quan trong Tab Admin: xem số key active/cooldown, tag trạng thái và nút *Đặt lại Cooldown*.

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

## 📁 Cấu trúc Thư mục Dự án

```text
dsh-plugin-user-manager/
├── lib/
│   ├── index.js                  # Entrypoint chính của Cordis Plugin & re-exports
│   ├── common/                   # [Chức năng Dùng chung & Cốt lõi]
│   │   ├── db.js                 # SQLite database, schema, migrations, hashing
│   │   └── auth.js               # Xác thực JWT, đăng nhập, đăng ký, middleware
│   ├── admin/                    # [Chức năng Dành riêng cho Quản trị viên]
│   │   └── model-guard.js        # Cấu hình Model, API Key, chặn user thường
│   ├── user/                     # [Chức năng & Kiểm soát Người dùng]
│   │   ├── workspace.js          # Không gian làm việc, cô lập tệp tin cá nhân
│   │   └── security-guard.js     # Sandbox lệnh shell, Document-Only runtime guard
│   ├── document/                 # [Chức năng Xử lý Tài liệu Đa định dạng]
│   │   ├── document-service.js   # API upload, quản lý attachments & trích xuất
│   │   ├── document-tool.js      # Định nghĩa Cordis Tool read_document
│   │   ├── document-extractor.js # Trích xuất PDF, DOCX, TXT chuyên sâu
│   │   └── document-worker.js    # Worker xử lý tài liệu đa luồng / timeout
│   └── ui/                       # [Giao diện & Tiêm UI vào DSH]
│       └── ui-injection.js       # Injected UI Login bar, Modal Admin, CSS rules
│
├── test/
│   ├── run-tests.js              # Runner chạy toàn bộ test suites
│   ├── run-unit.js               # Runner chạy riêng các bài Unit Test
│   ├── unit/                     # [Unit Tests]
│   │   ├── test-auth.js          # Test xác thực & phiên đăng nhập
│   │   ├── test-workspace.js     # Test cô lập thư mục workspace & traversal
│   │   ├── test-model-guard.js   # Test quản trị API key & chặn sửa model
│   │   ├── test-native-approval.js # Test phê duyệt người dùng & native command
│   │   ├── test-security-isolation.js # Test sandbox & phân quyền đa người dùng
│   │   └── test-document-v2.js   # Test trích xuất & xử lý tài liệu V2
│   ├── integration/              # [Integration Tests]
│   │   ├── test-auth-flow.js     # Test luồng auth hoàn chỉnh trên DSH live
│   │   ├── test-real-dsh-live.js # Test tương tác trực tiếp DSH port 3088
│   │   ├── test-real-advanced-security.js # Test bảo mật nâng cao live
│   │   ├── test-real-pwsh-guard.js # Test chặn powershell nguy hiểm
│   │   ├── test-real-ui-full.js  # Test UI injection đầy đủ
│   │   ├── test-document-integration.js # Test tích hợp xử lý tài liệu
│   │   ├── test-document-only-runtime.js # Test runtime chế độ document-only
│   │   └── test-comprehensive-non-tool-routes.js # Test rà soát bảo mật route REST
│   └── helpers/                  # [Bộ Hỗ trợ Test]
│       ├── fixtures.js           # Dữ liệu mẫu (PDF, DOCX mock)
│       └── inspect-browser-flow.js # Script kiểm tra browser flow
│
├── data/                         # SQLite users.db (tự sinh, gitignored)
├── public/                       # Dashboard fallback & login pages
└── package.json                  # Cấu hình package, dependencies & scripts
```

## 🧪 Testing

Chạy kiểm thử tự động với 1 lệnh:

```powershell
# Chạy toàn bộ test suites
npm test

# Hoặc chạy riêng các bài Unit Test
npm run test:unit
```

## 🛡️ Chế độ Document-Only & Giới hạn Kỹ thuật

- **Chế độ Document-Only cho người dùng thông thường**:
  - Người dùng thông thường (`role: 'user'`) chỉ được phép tương tác hội thoại và đọc tài liệu văn bản thông qua công cụ chuyên dụng `read_document` (hỗ trợ PDF có text layer, DOCX, TXT) với xác thực quyền sở hữu từ máy chủ.
  - Mọi công cụ shell (`pwsh`, `bash`, `cmd`), thực thi mã nguồn (`run_code`, `subprocess`) và công cụ filesystem trực tiếp (`read`, `write`, `edit`, `fs_search`) đều bị **khóa cứng ở tầng runtime** (`ctx.tools.guard`), bất kể lệnh vô hại hay script nội bộ.
- **Tài liệu PDF Scanned**:
  - Bản phát hành hiện tại chỉ trích xuất text layer kỹ thuật số; **chưa tích hợp OCR** cho tài liệu scan dạng hình ảnh thuần túy.
- **Ranh giới Sandbox & Phạm vi kiểm soát**:
  - Bản phát hành hiện tại thực hiện kiểm soát và cô lập tại tầng ToolRuntime của DSH/Cordis.
  - Bản này **chưa có cô lập cấp hệ điều hành (OS)** (không tạo Windows Local User riêng hay container Docker cho từng session).
  - Hệ thống bảo vệ các route REST và luồng tool đã được plugin kiểm soát, nhưng **chưa xác minh toàn bộ kênh ngoài ToolRuntime** (chẳng hạn các socket hoặc extension bên thứ ba chạy ngoài Cordis Tool Engine).
- **Quyền hạn Quản trị viên (Admin)**:
  - Tài khoản Admin đã xác thực qua cơ sở dữ liệu máy chủ giữ toàn quyền thực thi công cụ shell và quản trị hệ thống. Quyền admin không thể bị mạo nhận hoặc leo thang thông qua prompt/header.

## 📄 License

MIT

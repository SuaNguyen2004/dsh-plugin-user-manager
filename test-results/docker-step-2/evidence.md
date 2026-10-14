# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 2: CHUẨN HÓA ĐƯỜNG DẪN VÀ KIỂM THỬ CÔ LẬP

## 1. Thông tin nền tảng & Git
- **Base Commit SHA**: `eddfaf19ee12592f25ab18d8811eb1047f5b7261`
- **Branch hiện tại**: `dockerization/document-only`
- **DSH Windows Host (3088)**: PID `20932`, trạng thái `Responding: True`, không can thiệp, không restart, không thay đổi dữ liệu.
- **Test Port dự kiến**: `3090` (đã xác nhận trống).

---

## 2. Danh sách các file chỉnh sửa & bổ sung
1. [`.gitignore`](file:///c:/Users/Admin/Desktop/User%20Management/.gitignore): Bổ sung `test/.tmp*` để cô lập toàn bộ thư mục tạm sinh ra từ các đợt kiểm thử.
2. [`lib/index.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/index.js): Giữ nguyên `process.env.DSH_HOME` nếu đã được cấu hình; fallback qua `os.homedir()` thay vì `C:\Users\Admin`.
3. [`lib/common/db.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/common/db.js): 
   - Xuất hàm `getWorkspacesRoot()` ưu tiên `process.env.USERS_WORKSPACES_ROOT`.
   - Áp dụng `getWorkspacesRoot()` trong khởi tạo admin workspace và `createUser()`.
   - Bổ sung `closeDatabase()` để đóng kết nối và hỗ trợ reopen trong kiểm thử cô lập.
   - Bổ sung bắt lỗi khi tạo thư mục DB / workspace thất bại.
4. [`lib/user/workspace.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/user/workspace.js):
   - Thay thế hardcoded `WORKSPACES_ROOT` bằng `getWorkspacesRoot()`.
   - `getUserWorkspaceDir(username)` và `cleanupUserWorkspaceAndSessions(username)` đồng bộ qua `getWorkspacesRoot()`.
   - `getDshHome()` fallback qua `os.homedir()`.
5. [`lib/admin/model-guard.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/admin/model-guard.js):
   - `getDshPaths()` fallback qua `os.homedir()`.
6. [`lib/document/document-tool.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/document/document-tool.js):
   - Phân giải `defineTool` đa nền tảng (APPDATA, Linux global node_modules, `os.homedir()`) không hardcode `C:\Users\Admin`.
7. [`lib/user/security-guard.js`](file:///c:/Users/Admin/Desktop/User%20Management/lib/user/security-guard.js):
   - Đồng bộ `getAllUserWorkspaceDirs()` qua `getWorkspacesRoot()`.
   - `isAttachmentStorePath()` nhận diện cả `process.env.DSH_HOME/attachments`.
8. [`test/unit/test-docker-step2-paths.js`](file:///c:/Users/Admin/Desktop/User%20Management/test/unit/test-docker-step2-paths.js): Bộ kiểm thử cô lập chuyên biệt 10 tiêu chí cho Bước 2.

---

## 3. Các lệnh đã thực thi & Trạng thái

### 3.1. Kiểm thử trên Windows Host
- **Lệnh**: `node test/unit/test-docker-step2-paths.js`
- **Exit Code**: `0`
- **Đường dẫn test cô lập trên Host**: `test\.tmp-docker-step2\step2-1791971458178-921osi\`

| STT | Tên ca kiểm thử | Kết quả | Thời gian |
|:---:|:---|:---:|:---:|
| 1 | Khởi tạo cơ sở dữ liệu SQLite tại thư mục test cô lập | **PASS** | 113ms |
| 2 | Tạo 2 user giả và kiểm tra getUserWorkspaceDir khớp workspace_path | **PASS** | 172ms |
| 3 | Đọc/ghi file TXT UTF-8 có tên tiếng Việt và khoảng trắng | **PASS** | 8ms |
| 4 | Chặn đọc/ghi chéo workspace giữa hai user | **PASS** | 13ms |
| 5 | Chặn đọc chéo attachment của user khác | **PASS** | 13ms |
| 6 | Document-Only mode chặn shell tools (pwsh, bash, cmd, run_command) cho user thường | **PASS** | 6ms |
| 7 | Guard gặp lỗi hoặc tham số không hợp lệ phải từ chối (Fail-Closed) | **PASS** | 1ms |
| 8 | Đóng/mở lại DB và Key Pool, dữ liệu test được bảo toàn chính xác | **PASS** | 16ms |
| 9 | Cấu hình thư mục không ghi được phải báo lỗi rõ ràng | **PASS** | 3ms |
| 10 | Xác nhận không phát sinh ghi vào data/workspaces/DSH_HOME thật | **PASS** | 6ms |

### 3.2. Kiểm thử trên Linux Container Tạm (Docker)
- **Image**: `node:22-bookworm-slim` (Linux/amd64, Node v22.23.3)
- **Lệnh**:
  ```bash
  docker run --rm -v "${PWD}:/app:ro" -w /app -e TEST_ROOT=/tmp/step2-test node:22-bookworm-slim node test/unit/test-docker-step2-paths.js
  ```
- **Exit Code**: `0`
- **Đường dẫn test cô lập trong Container**:
  - `TEST_ROOT`: `/tmp/step2-test`
  - `DSH_HOME`: `/tmp/step2-test/dsh_home`
  - `USERS_DB_PATH`: `/tmp/step2-test/db/users.db`
  - `DSH_KEY_POOLS_FILE`: `/tmp/step2-test/db/key_pools.json`
  - `USERS_WORKSPACES_ROOT`: `/tmp/step2-test/workspaces`

| STT | Tên ca kiểm thử | Kết quả | Thời gian |
|:---:|:---|:---:|:---:|
| 1 | Khởi tạo cơ sở dữ liệu SQLite tại thư mục test cô lập | **PASS** | 162ms |
| 2 | Tạo 2 user giả và kiểm tra getUserWorkspaceDir khớp workspace_path | **PASS** | 187ms |
| 3 | Đọc/ghi file TXT UTF-8 có tên tiếng Việt và khoảng trắng | **PASS** | 3ms |
| 4 | Chặn đọc/ghi chéo workspace giữa hai user | **PASS** | 8ms |
| 5 | Chặn đọc chéo attachment của user khác | **PASS** | 13ms |
| 6 | Document-Only mode chặn shell tools (pwsh, bash, cmd, run_command) cho user thường | **PASS** | 6ms |
| 7 | Guard gặp lỗi hoặc tham số không hợp lệ phải từ chối (Fail-Closed) | **PASS** | 1ms |
| 8 | Đóng/mở lại DB và Key Pool, dữ liệu test được bảo toàn chính xác | **PASS** | 11ms |
| 9 | Cấu hình thư mục không ghi được phải báo lỗi rõ ràng | **PASS** | 1ms |
| 10 | Xác nhận không phát sinh ghi vào data/workspaces/DSH_HOME thật | **PASS** | 52ms |

---

## 4. Xác nhận tính bất biến của dữ liệu thật
- Dữ liệu thật tại `data/`, `workspaces/` và `C:\Users\Admin\.dsh-multiuser` đã được snapshot đối chiếu trước và sau khi chạy test:
  - Danh sách file và mtime hoàn toàn trùng khớp 100%.
  - Không có file dữ liệu thật nào bị ghi đè hoặc sinh mới ngoài thư mục test cô lập.
- Không có secret, credential hay API key thực tế nào được nạp vào fixture kiểm thử.

---

## 5. Kiểm tra định dạng Git
- Lệnh: `git diff --check`
- Kết quả: Không có lỗi khoảng trắng, không có lỗi cú pháp.


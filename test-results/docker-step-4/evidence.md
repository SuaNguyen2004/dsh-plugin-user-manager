# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 4: DOCKER COMPOSE & PERSISTENCE TEST (PORT 3090)
*(Cập nhật bổ sung sau khi khắc phục review commit `8cca15d`)*

## 1. Thông tin nền tảng & Git
- **Branch**: `dockerization/document-only`
- **Base Commit SHA**: `8cca15d045d656dd3d410db4e5b7fb58c9735d6e`
- **DSH Windows Host (3088)**: PID `27324`, trạng thái `LISTENING` liên tục, không bị can thiệp, dữ liệu gốc hoàn toàn nguyên vẹn.
- **DSH Docker Test Service**: Đang lắng nghe tại `127.0.0.1:3090` (chỉ mở trên loopback host).
- **Base Image Pinned**: `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`
- **Built Image Tag**: `dsh-document-only:step3`
- **Built Image ID**: `sha256:b7f56c81d9b145ca0a658941f3549eec145a7fc687d952ef1ad9e45d2269da22`
- **User trong Container**: `node` (UID: `1000`, GID: `1000`), không chạy quyền root, không privileged, không mount Docker socket.

---

## 2. Đường dẫn dữ liệu Host & Ánh xạ Container
Toàn bộ dữ liệu của phiên bản Docker thử nghiệm được lưu tại thư mục độc lập, hoàn toàn tách biệt khỏi `data/` và `workspaces/` của Windows host:

| Thành phần dữ liệu | Đường dẫn tuyệt đối trên Host (Windows) | Ánh xạ Volume trong Container | Quyền ghi nhận |
| :--- | :--- | :--- | :--- |
| **Database & Key Pool** | `C:\Users\Admin\Desktop\User Management\docker-test-data\db` | `/data/db` | `node:node` (`users.db`, `key_pools.json`) |
| **DSH Home** | `C:\Users\Admin\Desktop\User Management\docker-test-data\dsh_home` | `/data/dsh_home` | `node:node` (profiles, sessions, attachments) |
| **User Workspaces** | `C:\Users\Admin\Desktop\User Management\docker-test-data\workspaces` | `/data/workspaces` | `node:node` (thư mục workspace từng user) |
| **Temp Directory** | `C:\Users\Admin\Desktop\User Management\docker-test-data\temp` | `/data/temp` | `node:node` |

---

## 3. Các sửa đổi trọng tâm sau Review 8cca15d
1. **Chmod Workaround Scoped**:
   - Gỡ bỏ toàn bộ monkey patch toàn cục khỏi `lib/index.js`.
   - `patch-chmod.cjs` chỉ kích hoạt khi có cờ môi trường `ENABLE_DOCKER_CHMOD_WORKAROUND=true`, chống patch lặp.
   - Giới hạn xử lý bỏ qua `EPERM`/`EINVAL` nghiêm ngặt tại duy nhất mount root được cấu hình (`$DSH_HOME` hoặc `/data/dsh_home`). Tái ném lỗi rõ ràng trên mọi đường dẫn khác.
2. **Workspace Deduplication**:
   - Khi hợp nhất các workspace cùng đường dẫn, hợp nhất toàn bộ `sessionIds` (union không trùng lặp) vào workspace chính thức.
   - Cập nhật ánh xạ `user_sessions` SQLite (`UPDATE user_sessions SET workspace_id = ? WHERE workspace_id = ?`).
   - Cập nhật tham chiếu `data.global.defaultWorkspaceId` và `data.global.workspaceIds`.
   - Không xóa dữ liệu đĩa hay session cache của các session được hợp nhất.
3. **Entrypoint Không Nuốt Lỗi**:
   - Bỏ toàn bộ `|| true` ở các bước tạo thư mục và ghi cấu hình.
   - Thoát với exit code `1` và thông điệp lỗi rõ ràng khi thư mục profile không ghi được (read-only).
   - Bảo toàn cấu hình hiện hữu, xác thực symlink plugin và file config trước khi khởi chạy DSH.
4. **Build Context**:
   - Thêm `docker-test-data/`, `docker-test-data*`, `.env*`, `*.secret*`, `secrets/` vào `.dockerignore`.
   - Pin base image bằng digest `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`.
5. **Kiểm thử Bảo vệ & An toàn**:
   - Bọc toàn bộ test runner trong khối `try ... finally` để luôn tự động chuyển về cấu hình tắt test endpoint khi hoàn thành hoặc có lỗi.
   - Xác thực sâu thông báo lỗi Document-Only từ runtime tool guard.

---

## 4. Kết quả kiểm thử tự động (31/31 PASS)
Script kiểm thử thực tế đã chạy: `node test/unit/test-docker-step4-persistence.js`
Exit code: `0`

| STT | Tên ca kiểm thử | Kết quả | Chi tiết xác nhận |
| :---: | :--- | :---: | :--- |
| **0.1** | DSH Windows 3088 nguyên vẹn | **PASS** | Port 3088 LISTENING nguyên vẹn (PID 27324) |
| **1.1** | `docker compose config` hợp lệ | **PASS** | Không lộ secret, bind chặt `127.0.0.1:3090`, image `dsh-document-only:step3` |
| **1.2** | Dockerfile pinned base image digest | **PASS** | `node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392` |
| **1.3** | `patch-chmod.cjs` chỉ xử lý mount root cho phép | **PASS** | Bỏ qua EPERM trên `/data/dsh_home`, ném EPERM trên thư mục khác |
| **1.4** | `patch-chmod.cjs` giữ nguyên hành vi khi không bật flag | **PASS** | Không patch khi `ENABLE_DOCKER_CHMOD_WORKAROUND!=true` |
| **1.5** | Entrypoint thất bại rõ ràng (exit 1) khi profile dir read-only | **PASS** | Không nuốt lỗi, exit 1 với thông điệp: "Profile directory is not writable" |
| **2.1** | Container khởi động trên 3090 | **PASS** | `http://127.0.0.1:3090/login.html` trả về HTTP 200 |
| **2.2** | Test execution endpoint mặc định tắt | **PASS** | Trả về HTTP 403: "Endpoint bị vô hiệu hóa mặc định trong môi trường production." |
| **3.1** | Chuyển sang compose cấu hình test thành công | **PASS** | Kích hoạt `ENABLE_DSH_TEST_ENDPOINTS=true` phục vụ kiểm thử end-to-end |
| **3.2** | Đăng nhập Admin thành công | **PASS** | User `admin`, Role `admin`, nhận session token |
| **3.3** | Cấu hình Key Pool giả lập | **PASS** | Ref: `TEST_STEP4_POOL_KEY`, mode pool |
| **3.4** | Đăng ký & phê duyệt 2 user test | **PASS** | `test_alice` và `test_bob` đăng ký (pending) và được admin phê duyệt (active) |
| **3.5** | Đăng nhập Alice và Bob | **PASS** | Cả hai user test đăng nhập thành công và nhận session token riêng biệt |
| **3.6** | Alice tạo DSH Session 1 qua user-init | **PASS** | Phiên làm việc được tạo và gắn quyền hợp lệ |
| **3.7** | Tạo file workspace cho Alice | **PASS** | `workspace_document.txt` chứa marker kiểm thử tiếng Việt UTF-8 |
| **3.8** | Upload attachment 1 cho Session 1 thành công | **PASS** | Tải lên tệp TXT đính kèm thành công vào DSH attachment store |
| **3.9** | `read_document` đọc attachment 1 qua runtime | **PASS** | Tool `read_document` trích xuất chính xác nội dung đính kèm khớp marker 1 |
| **3.10** | `read_document` đọc file workspace qua runtime | **PASS** | Tool `read_document` đọc trực tiếp file trong workspace khớp marker workspace |
| **3.11** | Document-Only Guard chặn lệnh shell với thông điệp rõ ràng | **PASS** | Chặn lệnh shell, thông báo từ chối của chế độ Document-Only xác nhận từ runtime |
| **3.12** | Tạo Session 2 và upload attachment 2 thành công | **PASS** | Session 2 được tạo và upload attachment 2 thành công |
| **3.13** | Workspace Deduplication hợp nhất hoàn hảo | **PASS** | `sessionIds` được union, duplicate workspace bị xóa, cả 2 session đọc được attachment |
| **4.1** | `docker compose restart` thành công | **PASS** | Khởi động lại container giữ nguyên volume mounts |
| **4.2** | Dữ liệu User SQLite bảo toàn sau restart | **PASS** | `test_alice` và `test_bob` vẫn tồn tại và đăng nhập bình thường |
| **4.3** | Cấu hình Key Pool bảo toàn sau restart | **PASS** | `key_pools.json` trên host đĩa vẫn bảo lưu `TEST_STEP4_POOL_KEY` |
| **4.4** | Cả Session 1 và Session 2 đọc lại attachment sau restart | **PASS** | Bảo toàn phiên làm việc, attachment và phân quyền qua restart |
| **5.1** | `docker compose up --force-recreate` thành công | **PASS** | Hủy container và tạo container mới toanh từ image |
| **5.2** | User và Key Pool bảo toàn sau recreate | **PASS** | SQLite DB và key pool file trên host không bị mất |
| **5.3** | Cả Session 1 và Session 2 đọc lại attachment sau recreate | **PASS** | Dữ liệu và file cache hoàn toàn nguyên vẹn sau khi hủy và tạo lại container |
| **6.1** | Entrypoint bảo vệ cấu hình hiện hữu, không ghi đè | **PASS** | Không ghi đè / reset cấu hình hiện hữu |
| **7.1** | Cấu hình bàn giao hoàn tất, test endpoint đã tắt | **PASS** | Container đang chạy bản cấu hình chuẩn trên `127.0.0.1:3090`, test endpoint trả 403 |
| **7.2** | DSH Windows 3088 vẫn nguyên vẹn và hoạt động | **PASS** | PID Windows 27324 hoạt động liên tục không gián đoạn |

---

## 5. Hướng dẫn vận hành & Lệnh điều khiển Docker Test Service

| Thao tác | Lệnh thực hiện | Đặc tính lưu trữ dữ liệu |
| :--- | :--- | :--- |
| **Khởi chạy nền (Start)** | `docker compose up -d` | **Giữ nguyên dữ liệu** (đọc/ghi từ `docker-test-data/`) |
| **Dừng an toàn (Stop)** | `docker compose stop` | **Giữ nguyên dữ liệu** |
| **Khởi động lại (Restart)** | `docker compose restart` | **Giữ nguyên dữ liệu** |
| **Hạ container (Down)** | `docker compose down` | **Giữ nguyên dữ liệu** (chỉ xóa container và network, không xóa thư mục mount) |
| **Xem log thời gian thực** | `docker compose logs -f` | Không ảnh hưởng dữ liệu |
| **CẢNH BÁO: KHÔNG DÙNG** | `docker compose down -v` hoặc `docker volume prune` | Lệnh này có cờ xóa volume |

---

## 6. Trạng thái bàn giao hiện tại
- DSH Docker thử nghiệm đang **chạy nền** tại: [http://127.0.0.1:3090/login.html](http://127.0.0.1:3090/login.html)
- Endpoint test thực thi tool đã được **tắt hoàn toàn** (trả 403 Forbidden).
- DSH Windows cổng 3088 hoạt động độc lập, không bị ảnh hưởng.

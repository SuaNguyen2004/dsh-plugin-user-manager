# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 4: DOCKER COMPOSE & PERSISTENCE TEST (PORT 3090)

## 1. Thông tin nền tảng & Git
- **Branch**: `dockerization/document-only`
- **Base Commit SHA**: `cd3306813ef8bec04ba8cda4425ddecfb46732c4`
- **DSH Windows Host (3088)**: PID `27324`, trạng thái `LISTENING` liên tục, không bị can thiệp, dữ liệu gốc hoàn toàn nguyên vẹn.
- **DSH Docker Test Service**: Đang lắng nghe tại `127.0.0.1:3090` (chỉ mở trên loopback host).
- **Built Image Tag**: `dsh-document-only:step3`
- **Built Image ID**: `sha256:6e99e520c4b328d9b931ef107d1b5cfc864c1c432260fa4b3025e8b54907c552`
- **User trong Container**: `node` (UID: `1000`, GID: `1000`), không chạy quyền root, không privileged, không mount Docker socket.

---

## 2. Đường dẫn dữ liệu Host & Ánh xạ Container
Toàn bộ dữ liệu của phiên bản Docker thử nghiệm được lưu tại thư mục mới độc lập, hoàn toàn tách biệt khỏi `data/` và `workspaces/` của Windows host:

| Thành phần dữ liệu | Đường dẫn tuyệt đối trên Host (Windows) | Ánh xạ Volume trong Container | Quyền ghi nhận |
| :--- | :--- | :--- | :--- |
| **Database & Key Pool** | `C:\Users\Admin\Desktop\User Management\docker-test-data\db` | `/data/db` | `node:node` (`users.db`, `key_pools.json`) |
| **DSH Home** | `C:\Users\Admin\Desktop\User Management\docker-test-data\dsh_home` | `/data/dsh_home` | `node:node` (profiles, sessions, attachments) |
| **User Workspaces** | `C:\Users\Admin\Desktop\User Management\docker-test-data\workspaces` | `/data/workspaces` | `node:node` (thư mục workspace từng user) |
| **Temp Directory** | `C:\Users\Admin\Desktop\User Management\docker-test-data\temp` | `/data/temp` | `node:node` |

---

## 3. Cấu hình Docker Compose (`docker-compose.yml`)
```yaml
services:
  dsh-document-only:
    build:
      context: .
      dockerfile: Dockerfile
    image: dsh-document-only:step3
    container_name: dsh-document-only-test
    user: "1000:1000"
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "127.0.0.1:3090:3090"
    environment:
      - NODE_ENV=production
      - DSH_HOME=/data/dsh_home
      - USERS_DB_PATH=/data/db/users.db
      - DSH_KEY_POOLS_FILE=/data/db/key_pools.json
      - USERS_WORKSPACES_ROOT=/data/workspaces
      - TEMP=/data/temp
      - TMP=/data/temp
      - PORT=3090
      - ENABLE_DSH_TEST_ENDPOINTS=${ENABLE_DSH_TEST_ENDPOINTS:-false}
    volumes:
      - ./docker-test-data/db:/data/db
      - ./docker-test-data/dsh_home:/data/dsh_home
      - ./docker-test-data/workspaces:/data/workspaces
      - ./docker-test-data/temp:/data/temp
```

---

## 4. Kết quả kiểm thử tự động (25/25 PASS)
Script kiểm thử thực tế đã chạy: [`test/unit/test-docker-step4-persistence.js`](file:///c:/Users/Admin/Desktop/User%20Management/test/unit/test-docker-step4-persistence.js)
Exit code: `0`

| STT | Tên ca kiểm thử | Kết quả | Chi tiết xác nhận |
| :---: | :--- | :---: | :--- |
| **0.1** | DSH Windows 3088 nguyên vẹn | **PASS** | Port 3088 LISTENING nguyên vẹn (PID 27324) |
| **1.1** | `docker compose config` hợp lệ | **PASS** | Không lộ secret, bind chặt `127.0.0.1:3090`, image `dsh-document-only:step3` |
| **2.1** | Container khởi động trên 3090 | **PASS** | `http://127.0.0.1:3090/login.html` trả về HTTP 200 |
| **2.2** | Test execution endpoint mặc định tắt | **PASS** | Trả về HTTP 403: `"Endpoint bị vô hiệu hóa mặc định trong môi trường production."` |
| **3.1** | Khởi động cấu hình test tạm thời | **PASS** | Kích hoạt `ENABLE_DSH_TEST_ENDPOINTS=true` phục vụ kiểm thử end-to-end |
| **3.2** | Đăng nhập Admin thành công | **PASS** | User `admin`, Role `admin`, nhận session token |
| **3.3** | Cấu hình Key Pool giả lập | **PASS** | Ref: `TEST_STEP4_POOL_KEY`, mode pool |
| **3.4** | Đăng ký & phê duyệt 2 user test | **PASS** | `test_alice` và `test_bob` đăng ký (pending) và được admin phê duyệt (active) |
| **3.5** | Đăng nhập Alice và Bob | **PASS** | Cả hai user test đăng nhập thành công và nhận session token riêng biệt |
| **3.6** | Alice tạo DSH session qua user-init | **PASS** | Phiên làm việc được tạo và gắn quyền hợp lệ |
| **3.7** | Tạo file workspace cho Alice | **PASS** | `workspace_document.txt` chứa marker kiểm thử tiếng Việt UTF-8 |
| **3.8** | Upload attachment cho Alice | **PASS** | Tải lên tệp TXT đính kèm thành công vào DSH attachment store |
| **3.9** | `read_document` đọc attachment qua runtime | **PASS** | Tool `read_document` trích xuất chính xác nội dung đính kèm khớp marker |
| **3.10** | `read_document` đọc file workspace qua runtime | **PASS** | Tool `read_document` đọc trực tiếp file trong workspace khớp marker |
| **3.11** | Document-Only Guard chặn shell user thường | **PASS** | Lệnh shell (`bash`/`pwsh`) bị chặn với thông báo từ chối của chế độ Document-Only |
| **4.1** | `docker compose restart` thành công | **PASS** | Khởi động lại container giữ nguyên volume mounts |
| **4.2** | Dữ liệu User SQLite bảo toàn sau restart | **PASS** | `test_alice` và `test_bob` vẫn tồn tại và đăng nhập bình thường |
| **4.3** | Cấu hình Key Pool bảo toàn sau restart | **PASS** | `key_pools.json` trên host đĩa vẫn bảo lưu `TEST_STEP4_POOL_KEY` |
| **4.4** | `read_document` đọc lại attachment sau restart | **PASS** | Session và quyền attachment được bảo toàn, đọc lại file thành công |
| **5.1** | `docker compose up --force-recreate` thành công | **PASS** | Hủy container và tạo container mới toanh từ image |
| **5.2** | User và Key Pool bảo toàn sau recreate | **PASS** | SQLite DB và key pool file trên host không bị mất |
| **5.3** | `read_document` đọc lại attachment sau recreate | **PASS** | File attachment đọc lại thành công 100% không suy suyển |
| **6.1** | Entrypoint không ghi đè / reset cấu hình | **PASS** | Entrypoint chỉ tạo config khi thiếu; marker thêm vào config vẫn giữ nguyên sau restart |
| **7.1** | Bàn giao cấu hình chuẩn (test endpoint tắt) | **PASS** | Container đang chạy bản cấu hình chuẩn trên `127.0.0.1:3090`, test endpoint trả 403 |
| **7.2** | DSH Windows 3088 vẫn chạy ổn định | **PASS** | PID Windows 27324 hoạt động liên tục không gián đoạn |

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
- Tài khoản quản trị đã khởi tạo: `admin` (mật khẩu mặc định: `admin123`).
- Hai tài khoản người dùng thử nghiệm đã sẵn sàng:
  - `test_alice` / `PasswordAlice123!` (Role: `user`, Status: `active`)
  - `test_bob` / `PasswordBob123!` (Role: `user`, Status: `active`)


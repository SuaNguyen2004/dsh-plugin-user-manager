# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 3: BUILD VÀ KIỂM THỬ DOCKER IMAGE CHO DSH DOCUMENT-ONLY

## 1. Thông tin nền tảng & Git
- **Branch**: `dockerization/document-only`
- **Base Commit SHA**: `cd3306813ef8bec04ba8cda4425ddecfb46732c4`
- **DSH Windows Host (3088)**: PID `27324`, trạng thái `Responding: True`, không bị can thiệp, dữ liệu gốc hoàn toàn nguyên vẹn.
- **Test Port dự kiến**: `3090` (và `3099` cho kiểm thử nội bộ container).

---

## 2. Thông số Docker Image & Môi trường xây dựng
- **Base Image**: `node:22-bookworm-slim` (Debian 12 Bookworm slim, Linux/amd64)
- **Base Image Digest**: `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`
- **Built Image Tag**: `dsh-document-only:step3`
- **Built Image ID**: `sha256:5d8e84066fc979d38d2d431325d4897d391b776bee61e2c88fe106c13b6b23d7`
- **Node.js Runtime trong Image**: `v22.23.3` (Node 22 LTS, hỗ trợ chuẩn `node:sqlite` và ESM).
- **DSH CLI Runtime trong Image**: `@deepseek-ai/dsh@0.2.0-rc.2`.
- **User trong Container**: `node` (UID: `1000`, GID: `1000`), không chạy quyền root.
- **Quyền bảo mật thư mục**:
  - `/app` (Codebase): Owned bởi `root:root`, quyền `755` -> Người dùng `node` chỉ được đọc và thực thi, **bị chặn ghi hoàn toàn** (`EACCES`).
  - `/data` (Data directories: `dsh_home`, `db`, `workspaces`, `temp`): Owned bởi `node:node`, quyền `775` -> Cho phép ghi dữ liệu người dùng.

---

## 3. Cơ chế đăng ký Plugin vào DSH Runtime
DSH khởi động theo kiến trúc Cordis Profile (`dsh --profile web`):
1. **Liên kết Plugin**: Plugin `dsh-plugin-user-manager` được cài đặt tại `/app` và được symlink vào `node_modules/dsh-plugin-user-manager` của profile web thông qua [`docker-entrypoint.sh`](file:///c:/Users/Admin/Desktop/User%20Management/docker-entrypoint.sh).
2. **Khai báo Bundle trong Profile**:
   Tệp `$DSH_HOME/profiles/web/package.json` khai báo:
   ```json
   {
     "name": "dsh-profile-web",
     "private": true,
     "dependencies": {
       "dsh-plugin-user-manager": "link:/app"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-plugin-user-manager"
         ]
       }
     }
   }
   ```
3. **Khai báo Patch Layer**:
   Tệp `$DSH_HOME/profiles/web/cordis.patch.yml` khai báo kích hoạt:
   ```yaml
   - id: user-manager
     name: "dsh-plugin-user-manager"
     disabled: false
   ```
4. **Xác thực Composed Tree**: Lệnh `dsh web --dump-config` xác nhận `dsh-plugin-user-manager` nằm trong composed profile tree.

---

## 4. Kết quả kiểm thử thực tế trong Docker Image (`test-docker-step3-container.js`)
Lệnh kiểm thử đã chạy:
```bash
docker run --rm dsh-document-only:step3 node /app/test/unit/test-docker-step3-container.js
```
**Exit Code**: `0` (8/8 PASS)

| Nhóm | Tên ca kiểm thử | Kết quả | Thời gian | Ghi chú & Chi tiết |
|:---:|:---|:---:|:---:|:---|
| **A.1** | Xác minh phiên bản Node.js | **PASS** | 0ms | Phiên bản thực tế `v22.23.3` (Node 22 LTS). |
| **A.2** | Xác minh phiên bản DSH CLI | **PASS** | 181ms | Phiên bản thực tế `0.2.0-rc.2`. |
| **A.3** | Import plugin & dependencies | **PASS** | 278ms | `mammoth`, `pdf-parse`, `node:sqlite`, `dsh-plugin-user-manager` import thành công. |
| **B.1** | Xác nhận plugin nạp qua config | **PASS** | 245ms | `dsh web --dump-config` chứa `dsh-plugin-user-manager`. |
| **B.2 & C** | Khởi động DSH thật & đăng ký `read_document` | **PASS** | 4698ms | DSH thật khởi động cổng 3099, phục vụ `/login.html` (HTTP 200), xác thực đăng nhập `/api/auth/login` và `/api/auth/me` thành công. Log DSH xác nhận: `Tool "read_document" registered into Agent tools` và `Multi-User Tool Security Guard successfully installed`. |
| **D** | Trích xuất tài liệu (PDF, DOCX, TXT) trên Linux | **PASS** | 1653ms | - PDF tiếng Việt (`sample_multipage.pdf`): 2 trang, nhận diện đủ nội dung văn bản.<br>- DOCX bảng biểu (`sample_table.docx`): định dạng DOCX, trích xuất bảng biểu tiếng Việt.<br>- TXT UTF-8 (`sample_bom.txt`): loại bỏ BOM và đọc chuẩn UTF-8. |
| **E** | Cách ly đường dẫn dữ liệu qua biến môi trường | **PASS** | 220ms | `DSH_HOME`, `USERS_DB_PATH`, `DSH_KEY_POOLS_FILE`, `USERS_WORKSPACES_ROOT` điều hướng dữ liệu chính xác vào `/data/test_step3/` mà không chạm vào `/app`. |
| **F** | Quyền Non-Root (UID 1000) & Chặn ghi Codebase | **PASS** | 3ms | `process.getuid() === 1000`. Ghi vào `/data` thành công; cố tình ghi vào `/app` bị hệ điều hành chặn với lỗi `EACCES: permission denied`. |

---

## 5. Kết quả kiểm thử bộ Step 2 trên Image mới (`test-docker-step2-paths.js`)
Lệnh kiểm thử đã chạy:
```bash
docker run --rm -e TEST_ROOT=/data/test dsh-document-only:step3 node /app/test/unit/test-docker-step2-paths.js
```
**Exit Code**: `0` (10/10 PASS)

---

## 6. Kiểm tra Git & Không commit/push
- Đã chạy `git diff --check`.
- Không có lỗi syntax, không có log lớn hoặc file rác trong git working tree.
- Tuân thủ quy định: Chưa commit/push ở Bước 3.


# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 7: BACKUP VÀ KIỂM CHỨNG MIGRATION TRÊN BẢN SAO (CLONED VERIFICATION)

## 1. Thông tin nền tảng & Môi trường kiểm chứng
- **Branch**: `dockerization/document-only`
- **Commit nền**: `6511370795291d1fc5a08d766c7ec276bb7b4c43`
- **DSH Windows Host (3088)**: Tiến trình Windows đang lắng nghe cổng 3088 liên tục, nguyên vẹn, không bị gián đoạn hay sửa đổi dữ liệu gốc.
- **DSH Docker Container Thử nghiệm (3090)**: Đang chạy trên `127.0.0.1:3090` với test endpoint bị tắt (`403 Forbidden`).
- **Thư mục bản sao thử nghiệm (Clone)**: `test-cloned-migration-data/` hoàn toàn độc lập với dữ liệu gốc (đã được dọn dẹp sau test).
- **Cổng kiểm chứng container clone**: `127.0.0.1:3092` (đã teardown sạch sau khi hoàn tất kiểm thử).

---

## 2. Kết quả kiểm thử Backup & Migration (15/15 PASS)

| STT | Mã kiểm thử | Tên kịch bản | Kết quả | Chi tiết ghi nhận |
| :---: | :---: | :--- | :---: | :--- |
| **1** | `7.0` | DSH Windows 3088 nguyên vẹn & không gián đoạn | **PASS** | Tiến trình lắng nghe cổng 3088 hoạt động liên tục |
| **2** | `7.1` | Tạo snapshot dữ liệu Windows an toàn (atomic VACUUM INTO & clone) | **PASS** | Users: 4, Sessions: 115, Attachments: 44 (27 files) |
| **3** | `7.2` | Thực thi migration --dry-run & kiểm chứng manifest | **PASS** | Phát hiện 172 thay đổi cần áp dụng, dữ liệu clone giữ nguyên |
| **4** | `7.3` | Áp dụng migration chuẩn hóa toàn bộ đường dẫn Linux (/data/...) | **PASS** | Users DB: 4, Attachments DB: 44, Workspaces: 4, Sessions: 6 |
| **5** | `7.4` | Kiểm chứng tính Idempotent: chạy lại lần 2 không thay đổi hay hỏng dữ liệu | **PASS** | 0 changes, 100% skipped as already normalized |
| **6** | `7.5` | Khởi chạy DSH Docker container độc lập trên port 3092 với dữ liệu clone | **PASS** | Container dsh-migration-verify-3092 UP & Healthy |
| **7** | `7.6` | Xác thực tài khoản và session token trước đó được bảo toàn nguyên vẹn | **PASS** | Admin & NVS tokens verified (HTTP 200) |
| **8** | `7.7` | Bảo toàn danh sách phiên làm việc và ánh xạ workspace trong DSH | **PASS** | Workspace count: 4, Active sessions: 113, Archived: 20 |
| **9** | `7.8` | Đọc tài liệu lịch sử đã migrate thành công bằng document API | **PASS** | Read attachment sha256:private_a... (private_nvs.txt): 26 chars extracted |
| **10** | `7.9` | Bảo toàn trạng thái tài khoản và phân quyền người dùng | **PASS** | Active: 4, Disabled/Rejected: 0, Roles preserved 100% |
| **11** | `7.10` | Bảo toàn cấu hình Key Pool nguyên vẹn (100% byte fidelity) | **PASS** | Key pool size: 1248 bytes match |
| **12** | `7.11` | Kiểm soát truy cập chéo workspace/attachment trên container mới hoạt động nghiêm ngặt | **PASS** | Cross-read returned HTTP 403 Forbidden |
| **13** | `7.12` | So sánh chỉ số toàn vẹn dữ liệu: Users, Sessions, Attachments và File SHA-256 Hashes | **PASS** | Users: 4, Sessions: 115, Attachments: 44, File Hashes Matched: 27/27 (100%) |
| **14** | `7.13` | DSH Docker 3090 duy trì chế độ an toàn (test endpoint tắt 403) | **PASS** | HTTP 403 Forbidden verified |
| **15** | `7.14` | DSH Windows 3088 tiếp tục hoạt động liên tục | **PASS** | Cổng 3088 nguyên vẹn |

---

## 3. Tính nhất quán Toàn vẹn Dữ liệu & Đối chiếu Đa chiều (Reconciliation)

> [!IMPORTANT]
> **Phân biệt bản chất Snapshot SQLite vs. Tính nhất quán Đa thành phần**:
> - **Snapshot SQLite (`VACUUM INTO`)**: Chỉ đảm bảo tính nhất quán cục bộ bên trong file cơ sở dữ liệu `users.db` tại một thời điểm, nhưng **CHƯA ĐỦ** để tạo ra một bản backup nhất quán cho toàn bộ hệ thống DSH.
> - **Hệ sinh thái dữ liệu DSH Multi-User phụ thuộc chéo 4 thành phần**:
>   1. **Metadata Database (`users.db`)**: Bảng `users`, `sessions`, `attachments`, `user_sessions`.
>   2. **Kho file vật lý (`attachments/v1/files/...`)**: Chứa nội dung nhị phân của tài liệu.
>   3. **Kho lịch sử phiên (`sessions/`)**: Chứa file nén sự kiện `session.v4.jsonl.zstd`.
>   4. **Bộ nhớ trạng thái (`storages/workspace.json`, `session_projcache/`)**: Chứa ánh xạ workspace, CWD, và danh sách phiên.
> - Nếu chụp snapshot DB trong khi hệ thống đang ghi nhận file đính kèm hoặc đang streaming chat, DB sẽ trỏ tới file chưa flush xong hoặc session bị lệch trạng thái.

### Bảng đối chiếu 3 chiều của 100% bản ghi Attachment:
- **Khớp file vật lý**: 44/44 bản ghi attachment trong DB trỏ tới đúng 27 file duy nhất trên đĩa; kích thước `file_size` và mã băm SHA-256 của từng file khớp 100% trước và sau migration.
- **Khớp quyền sở hữu (`username`)**: 100% bản ghi attachment gắn liền với `username` hợp lệ đang hoạt động trong bảng `users` (`admin`, `nta`, `nva`, `nvs`), không có bản ghi mồ côi (orphan).
- **Khớp ngữ cảnh phiên (`session_id`)**: 100% attachment đều gắn với `session_id` hợp lệ có trong bảng `user_sessions` hoặc cấu trúc `workspace.json`.

| Danh mục dữ liệu | Dữ liệu gốc (Windows Production) | Dữ liệu sau Migration (Linux Container) | Trạng thái toàn vẹn |
| :--- | :---: | :---: | :---: |
| **Tổng số người dùng (Users)** | `4` | `4` | **100% Khớp** |
| **Tổng số phiên làm việc (User Sessions)** | `115` | `115` | **100% Khớp** |
| **Phiên làm việc Workspace (`workspace.json`)** | `113 active + 20 archived` | `113 active + 20 archived` | **100% Khớp** |
| **Tổng số bản ghi tài liệu (Attachments)** | `44` | `44` | **100% Khớp** |
| **Số file đính kèm thực tế trên đĩa** | `27` files | `27` files | **100% Khớp** |
| **Tính toàn vẹn nội dung file (SHA-256)** | `100% Hash baseline` | `27/27 (100%)` | **100% Byte-for-byte** |
| **Cấu hình Key Pool (`key_pools.json`)** | `1248 bytes` | `1248 bytes` | **100% Khớp** |
| **Phân quyền và trạng thái tài khoản** | `Admin, NTA, NVA, NVS` | `Admin, NTA, NVA, NVS` | **100% Khớp** |

> [!CAUTION]
> **Yêu cầu bắt buộc khi Cutover**: Phải **ngừng phát sinh ghi hoàn toàn** (đóng dịch vụ hoặc bật Maintenance Mode) trước khi tạo bản backup nhất quán cuối cùng (Cold Consistent Backup). Tuyệt đối không tự ý thực hiện cutover.

---

## 4. Kế hoạch Chuyển giao Thực tế (Production Cutover Plan)

> [!WARNING]
> **Về thời gian downtime**: Không cam kết thời gian cố định 2–3 phút nếu chưa đo đạc thực tế. Thời gian downtime phụ thuộc trực tiếp vào dung lượng kho tài liệu đính kèm, số lượng phiên và tốc độ I/O đĩa. Thời gian chính xác cần được đo lường trong buổi diễn tập (rehearsal).

### 4.1 Quy trình Cutover từng bước (Production Cutover Steps)
1. **Thông báo bảo trì**: Đặt banner bảo trì trên giao diện và thông báo người dùng ngừng phiên làm việc.
2. **Dừng dịch vụ DSH Windows một cách Graceful**:
   - Xác định PID thực tế đang lắng nghe cổng 3088:
     ```powershell
     $pids = Get-NetTCPConnection -LocalPort 3088 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique
     ```
   - Gửi tín hiệu dừng graceful (chờ tiến trình flush WAL và đóng socket an toàn):
     ```powershell
     Stop-Process -Id $pids
     ```
   - Chờ tối đa 30 giây để tiến trình tự giải phóng tài nguyên. Chỉ dùng lệnh cưỡng bức (`Stop-Process -Force` hoặc `taskkill /F`) nếu sau thời gian chờ tiến trình bị treo.
3. **Tạo bản sao lưu Nhất quán Tĩnh (Cold Consistent Backup)**:
   - Khi dịch vụ đã dừng hoàn toàn, copy toàn bộ:
     `data/users.db`, `data/key_pools.json`, `C:\Users\Admin\.dsh-multiuser`, `workspaces/`
     vào thư mục lưu trữ độc lập: `backup-prod-YYYYMMDD-HHMMSS/`.
   - **Giữ nguyên 100% dữ liệu Windows gốc**: Bản Windows gốc được giữ nguyên trạng thái tĩnh để làm điểm rollback tức thì nếu cần.
4. **Thực thi Migration trên bản sao dành riêng cho Docker**:
   - Sao chép dữ liệu từ bản backup sang thư mục mount production của Docker (ví dụ `/data/docker-production-data/`).
   - Chạy script chuẩn hóa đường dẫn trên bản sao này:
     ```bash
     node scripts/migrate-windows-to-linux.js --apply --data-dir=/data/docker-production-data
     ```
5. **Đồng bộ Cấu hình DSH Docker Production**:
   - Port mapping trên Host: `127.0.0.1:3088:3088`.
   - Biến môi trường cổng nội bộ: `PORT=3088`.
   - Lệnh khởi chạy: `CMD ["dsh", "web", "--port", "3088", "--no-open"]`.
   - Healthcheck: `HEALTHCHECK CMD curl -f http://127.0.0.1:${PORT}/login.html || exit 1`.
   - Khởi chạy container: `docker compose up -d`.
6. **Duy trì Trạng thái Bảo trì trong Suốt Giai đoạn Smoke Test**:
   - Giữ kết nối bên ngoài bị chặn hoặc chỉ mở loopback nội bộ để thực hiện smoke test:
     - Đăng nhập tài khoản quản trị và người dùng thường.
     - Kiểm tra đọc tài liệu lịch sử, mở session cũ.
     - Tải tài liệu mới thử nghiệm.
     - Xác nhận tool execution vẫn bị chặn nghiêm ngặt (chế độ Document-Only).
   - **Chưa nhận dữ liệu mới từ người dùng thật** trước khi hoàn tất toàn bộ smoke test và có quyết định nghiệm thu chính thức từ người phụ trách.
7. **Mở hệ thống chính thức sau khi nghiệm thu đạt chuẩn**.

---

## 5. Kế hoạch Phục hồi (Rollback Plan Chi tiết)

> [!CAUTION]
> **Không tuyên bố đồng bộ attachment delta là đủ**: Dữ liệu DSH là một thể thống nhất giữa SQLite, session JSONL, workspace metadata và file vật lý. Không thể chỉ copy file attachment mà khôi phục được hệ thống nếu đã có phát sinh ghi mới.

### Tình huống 1: Sự cố xảy ra khi CHƯA CÓ dữ liệu mới phát sinh
*(Xảy ra trong giai đoạn smoke test hoặc ngay sau khi khởi động container, chưa mở cho người dùng)*:
1. Dừng ngay Docker container: `docker compose down`.
2. Khởi động lại dịch vụ DSH Windows trên bản dữ liệu gốc (vốn được giữ nguyên vẹn ở Bước 3):
   ```cmd
   node "C:\Users\Admin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js" web --port 3088
   ```
3. Xác nhận dịch vụ Windows 3088 phục hồi hoạt động bình thường. Thời gian rollback: dưới 1 phút, an toàn 100%.

### Tình huống 2: Sự cố xảy ra khi ĐÃ CÓ dữ liệu mới phát sinh trong Docker
*(Đã mở dịch vụ cho người dùng và người dùng đã gửi prompt, tạo session hoặc tải tài liệu mới)*:
1. **Cảnh báo nghiêm trọng**: Tuyệt đối **KHÔNG** tự ý restore database cũ từ Cold Backup, vì thao tác này sẽ làm mất vĩnh viễn toàn bộ các session, tin nhắn, token và file mà người dùng đã tạo trong thời gian chạy Docker!
2. **Quy trình Reverse Migration bắt buộc**:
   - Dừng nhận request mới (bật lại Maintenance Mode).
   - Dừng Docker container: `docker compose down`.
   - Thực hiện quy trình chuyển đổi ngược (Reverse Migration) từ Linux sang Windows:
     a) Cập nhật lại đường dẫn trong SQLite `users.db`: từ `/data/workspaces/...` và `/data/dsh_home/...` về đường dẫn Windows `C:\...`.
     b) Cập nhật lại `workspace.json` và `session_projcache/` về đường dẫn Windows.
     c) Đổi tên các thư mục session từ `--data-workspaces-...--` về lại dạng Windows `--C-Users-...--`.
     d) Đồng bộ toàn bộ các file attachment mới, session mới, và SQLite DB đã chuyển đổi về thư mục Windows.
   - Khởi động lại dịch vụ DSH Windows trên thư mục đã tích hợp dữ liệu mới.
3. Nếu không thể reverse migration ngay lập tức: Giữ container Docker tiếp tục chạy và áp dụng bản vá lỗi tại chỗ (hotfix), tránh downtime kép và tránh mất dữ liệu của người dùng.

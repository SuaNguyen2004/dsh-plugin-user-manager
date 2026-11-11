# BÁO CÁO ĐỐI CHIẾU MIGRATE DỮ LIỆU (PHASE 6)

> Thời gian chạy: `2026-10-25T13:33:45.043Z`
> **Trạng thái dữ liệu gốc trên Host (`data/`): GIỮ NGUYÊN 100% — chưa xóa.** Việc dọn dẹp host chỉ được thực hiện sau khi bạn xác nhận báo cáo này.

## 1. Đối chiếu tổng quan (Host trước → Volume sau)

| Hạng mục | Nguồn trên Host | Đích Volume | Số file | Dung lượng |
| :--- | :--- | :--- | :--- | :--- |
| SQLite + config gateway | `data/users.db` (+WAL, 159744 B) + 3 JSON | `dsh-gateway-data` | 4 | 104436 B |
| DSH homes (chat + settings) | `data/admin_dsh_home` + `data/dsh_homes/user-*` (105 file, 4055590 B) | `dsh-homes` | 102 | 4053208 B |
| Workspaces người dùng | `data/workspaces/*` + `dsh-vol-*` cũ | `dsh-vol-admin`, `dsh-vol-user1..5` | 7 | 610507 B |

## 2. Chi tiết từng volume workspace (chuẩn `/data/workspace/<user>/<ws>/files/<loại>/<file>`)

### User `admin` (id=1, role=admin) — volume `dsh-vol-admin`: 0 file / 0 B

_(chưa có file nào — đã tạo khung thư mục chuẩn)_

### User `alice` (id=2, role=user) — volume `dsh-vol-user2`: 3 file / 347788 B

- `/data/workspace/alice/alice-space/files/docs/Quy trình.docx` (318693 B)
- `/data/workspace/alice/default-workspace/files/docs/CV_đề_nghị_phối_hợp.docx` (22304 B)
- `/data/workspace/alice/default-workspace/files/docs/tom-tat-nghi-dinh-252-2026.docx` (6791 B)

### User `bob` (id=3, role=user) — volume `dsh-vol-user3`: 0 file / 0 B

_(chưa có file nào — đã tạo khung thư mục chuẩn)_

### User `david` (id=4, role=user) — volume `dsh-vol-user4`: 0 file / 0 B

_(chưa có file nào — đã tạo khung thư mục chuẩn)_

### User `nva` (id=5, role=user) — volume `dsh-vol-user5`: 4 file / 262719 B

- `/data/workspace/nva/default-workspace/files/docs/CV_đề_nghị_phối_hợp.docx` (22304 B)
- `/data/workspace/nva/default-workspace/files/docs/tom-tat-nghi-dinh-252-2026.docx` (6791 B)
- `/data/workspace/nva/default-workspace/files/images/image_0.jpg` (116355 B)
- `/data/workspace/nva/default-workspace/files/pdf/tom-tat-cong-van.pdf` (117269 B)

## 3. Nội dung volume `dsh-gateway-data`

- `/data/gateway/key_pools.json` (1409 B)
- `/data/gateway/models_config.json` (2 B)
- `/data/gateway/models_scope.json` (625 B)
- `/data/gateway/users.db` (102400 B)

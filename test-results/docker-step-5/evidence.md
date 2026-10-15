# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 5: API VÀ TOOLRUNTIME THẬT (PORT 3090)

## 1. Thông tin nền tảng & Môi trường
- **Branch**: `dockerization/document-only`
- **Commit nền**: `6511370795291d1fc5a08d766c7ec276bb7b4c43`
- **DSH Windows Host (3088)**: PID `27324` `LISTENING` liên tục, không bị can thiệp, dữ liệu gốc nguyên vẹn.
- **DSH Docker Container (3090)**: Đang chạy trên `127.0.0.1:3090`.
- **Image ID**: `sha256:fed3551c4529411982a46c95b3f99be3a96bfef5d7ce5b5fc041d081341c2c91`
- **Lệnh chạy kiểm thử**: `node test/integration/test-docker-step5-api-toolruntime.js`

## 2. Kết quả kiểm thử tự động (30/30 PASS)

| STT | Mã kiểm thử | Tên ca kiểm thử | Kết quả | Chi tiết xác nhận |
| :---: | :---: | :--- | :---: | :--- |
| **1** | `5.0` | DSH Windows 3088 nguyên vẹn | **PASS** | PID 27324 hoạt động liên tục |
| **2** | `5.1` | Chuyển Docker sang cấu hình test runtime | **PASS** | Port 3090 ready |
| **3** | `5.2` | Khởi tạo tài khoản & phiên làm việc Alice và Bob | **PASS** | Alice session: session-f8282d07..., Bob session: session-28e59d14... |
| **4** | `5.3A` | Đọc tệp TXT UTF-8 tiếng Việt có dấu chính chủ thành công | **PASS** | Khớp đầy đủ dấu tiếng Việt & BOM |
| **5** | `5.3B` | Đọc tệp DOCX có cấu trúc bảng chính chủ thành công | **PASS** | Trích xuất chính xác bảng biểu |
| **6** | `5.3C` | Đọc tệp PDF có text layer chính chủ thành công | **PASS** | Khớp chính xác nội dung text layer |
| **7** | `5.4A` | Đọc PDF mặc định (không truyền page) | **PASS** | Đọc thành công trang đầu tiên |
| **8** | `5.4B` | Đọc PDF theo trang cụ thể (page: 1) | **PASS** | Trích xuất chính xác trang 1 |
| **9** | `5.4C` | Đọc tiếp trang 2 đến hết tài liệu | **PASS** | Trích xuất chính xác trang cuối cùng |
| **10** | `5.5A` | Chặn Alice đọc chéo file workspace của Bob | **PASS** | Runtime từ chối truy cập ngoài workspace |
| **11** | `5.5B` | Chặn Bob đọc chéo file workspace của Alice | **PASS** | Runtime từ chối truy cập ngoài workspace |
| **12** | `5.5C` | Chặn Alice đọc chéo attachment của Bob | **PASS** | Xác thực quyền sở hữu attachment chặn thành công |
| **13** | `5.5D` | Chặn Bob đọc chéo attachment của Alice | **PASS** | Xác thực quyền sở hữu attachment chặn thành công |
| **14** | `5.5E` | Đối chứng: Alice đọc chính xác file workspace của mình | **PASS** | Thành công khi có quyền chính chủ |
| **15** | `5.5F` | Đối chứng: Bob đọc chính xác attachment của mình | **PASS** | Thành công khi có quyền chính chủ |
| **16** | `5.6A` | Chặn Bob upload file vào session của Alice | **PASS** | Trả về HTTP 403 session/forbidden |
| **17** | `5.6B` | Đối chứng: Alice upload vào session của chính mình thành công | **PASS** | HTTP 200 OK |
| **18** | `5.7_bash` | Chặn công cụ bị cấm "bash" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only đang được áp dụng cho tài khoản n |
| **19** | `5.7_pwsh` | Chặn công cụ bị cấm "pwsh" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only đang được áp dụng cho tài khoản n |
| **20** | `5.7_cmd` | Chặn công cụ bị cấm "cmd" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only đang được áp dụng cho tài khoản n |
| **21** | `5.7_terminal` | Chặn công cụ bị cấm "terminal" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only đang được áp dụng cho tài khoản n |
| **22** | `5.7_read` | Chặn công cụ bị cấm "read" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only yêu cầu truy cập tài liệu qua côn |
| **23** | `5.7_write` | Chặn công cụ bị cấm "write" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only yêu cầu truy cập tài liệu qua côn |
| **24** | `5.7_edit` | Chặn công cụ bị cấm "edit" cho user thường | **PASS** | Truy cập bị từ chối: Chế độ Document-Only yêu cầu truy cập tài liệu qua côn |
| **25** | `5.8A` | Token cũ của user bị vô hiệu hóa bị từ chối 401 | **PASS** | HTTP 401 Unauthorized |
| **26** | `5.8B` | Session của user bị vô hiệu hóa bị từ chối tại ToolRuntime | **PASS** | Từ chối truy cập session không hợp lệ |
| **27** | `5.9` | Hai file cùng tên a.pdf khác session đọc đúng từng bản, không ghi đè | **PASS** | ID1: sha256:514b6ed49... (1 trang), ID2: sha256:b95f3acfc... (2 trang) |
| **28** | `5.10` | Upload quá giới hạn bị từ chối 413 và không tạo attachment trong DB | **PASS** | Trả về 413 upload/too_large, database không có bản ghi rác |
| **29** | `5.11` | Khôi phục container về chế độ production (test endpoint tắt) | **PASS** | HTTP 403 Forbidden verified |
| **30** | `5.12` | DSH Windows 3088 vẫn nguyên vẹn và hoạt động | **PASS** | PID 27324 không bị gián đoạn |

---

## 3. Xác nhận bàn giao sau Bước 5
- DSH Docker 3090: Đang chạy nền, test endpoint đã vô hiệu hóa (HTTP 403 Forbidden).
- DSH Windows 3088: Hoàn toàn nguyên vẹn, không gián đoạn.
- Không sử dụng API key thật, không rò rỉ secret hoặc token.

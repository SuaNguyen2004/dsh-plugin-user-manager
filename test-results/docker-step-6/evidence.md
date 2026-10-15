# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 6: KIỂM THỬ TRÌNH DUYỆT (UI) VÀ VÒNG ĐỜI NGƯỜI DÙNG

## 1. Thông tin nền tảng & Môi trường kiểm thử
- **Branch**: `dockerization/document-only`
- **Commit nền**: `6511370795291d1fc5a08d766c7ec276bb7b4c43`
- **DSH Windows Host (3088)**: PID `27324` `LISTENING` liên tục, không bị gián đoạn, dữ liệu gốc nguyên vẹn.
- **DSH Docker Container (3090)**: Đang chạy trên `127.0.0.1:3090`.
- **Image ID**: `sha256:fed3551c4529411982a46c95b3f99be3a96bfef5d7ce5b5fc041d081341c2c91`
- **Mock LLM Server**: Chạy tại `http://127.0.0.1:3099` (tuyệt đối không dùng API key thật hay provider ngoài).
- **Trình duyệt tự động**: Headless Chrome qua giao thức Chrome DevTools Protocol (CDP), profile tạm thời độc lập.

## 2. Kết quả kiểm thử giao diện & Vòng đời người dùng (16/16 PASS)

| STT | Mã kiểm thử | Tên kịch bản | Kết quả | Chi tiết ghi nhận |
| :---: | :---: | :--- | :---: | :--- |
| **1** | `6.0` | DSH Windows 3088 nguyên vẹn & không gián đoạn | **PASS** | PID 27324 hoạt động liên tục |
| **2** | `6.1A` | Khởi chạy Mock LLM Provider cục bộ | **PASS** | 127.0.0.1:3099 ready |
| **3** | `6.1B` | Khởi chạy Chrome Headless trong temp profile độc lập | **PASS** | CDP attached: 9223 |
| **4** | `6.2` | Truy cập chưa xác thực tự động chuyển hướng /login | **PASS** | Screenshot: 01_unauthenticated_redirect_login.png |
| **5** | `6.3` | Đăng nhập Alice thành công từ giao diện web | **PASS** | Screenshot: 02_alice_login_success.png |
| **6** | `6.4` | Kiểm tra workspace và danh sách file của Alice hiển thị đúng | **PASS** | User bar: test_alice, File count: 2 |
| **7** | `6.5` | Upload tài liệu vào session của Alice thành công | **PASS** | Attachment ID: sha256:2072532fa... |
| **8** | `6.6` | Phiên làm việc Alice kích hoạt và vùng nhập liệu sẵn sàng | **PASS** | Composer element detected: true |
| **9** | `6.7` | F5 refresh trình duyệt: Phiên và attachment của Alice còn nguyên | **PASS** | Verified user test_alice, session session-2486ca06... |
| **10** | `6.8` | Tạo New Session tiếp theo cho Alice sạch sẽ & sẵn sàng | **PASS** | New Session ID: session-d8f5878b... |
| **11** | `6.9` | Đăng xuất khỏi tài khoản thành công | **PASS** | Token bị xóa, chuyển hướng /login |
| **12** | `6.10` | Bob đăng nhập trên cùng browser: Dữ liệu cô lập, không thấy Alice | **PASS** | Bob files: [bob_secret_doc.txt], Alice attachments excluded |
| **13** | `6.11` | Bob truy cập trực tiếp session/attachment của Alice bị từ chối 403 | **PASS** | Upload 403 Forbidden & Read 403 Forbidden |
| **14** | `6.12` | Chuyển lại Alice: Toàn bộ session và attachment được bảo toàn nguyên vẹn | **PASS** | Restored test_alice, Verified document sha256:2072532fa... |
| **15** | `6.13` | DSH Docker 3090 duy trì chế độ an toàn (test endpoint tắt 403) | **PASS** | HTTP 403 Forbidden verified |
| **16** | `6.14` | DSH Windows 3088 tiếp tục hoạt động liên tục | **PASS** | PID 27324 nguyên vẹn |
| **17** | `6.15` | Luồng UI: Prompt → Tool call `read_document` → Tool Content → Final Answer | **SKIP** | **Provider giả (Local Mock LLM 127.0.0.1:3099)**. Chưa cấu hình định tuyến bridge ra host trong container và chưa nạp multi-turn tool calling stream trong profile container. **Không tính PASS E2E**. |

> [!NOTE]
> **Giải trình về kiểm thử UI với Provider Local (Kịch bản 6.15 - SKIP)**:
> - **Môi trường LLM**: Sử dụng Local Mock Provider (`127.0.0.1:3099`), không dùng API key thật hay dịch vụ bên ngoài.
> - **Phạm vi đã kiểm chứng đạt chuẩn**:
>   1. **Bước 5 (ToolRuntime Backend)**: Đã kiểm chứng 100% trực tiếp trong Cordis runtime: đăng ký tool `read_document`, tiếp nhận tham số, phân quyền sở hữu, trích xuất văn bản (TXT, DOCX, PDF phân trang), và chặn toàn bộ các tool nguy hiểm (`bash`, `pwsh`, `read`, v.v.).
>   2. **Bước 6 (Giao diện Web UI)**: Đã kiểm chứng 100% luồng đăng nhập, tạo session, upload file đính kèm, refresh F5, đăng xuất, cô lập dữ liệu giữa Alice và Bob.
> - **Lý do đánh dấu SKIP**: Container thử nghiệm 3090 hiện tại chưa mở bridge định tuyến mạng nội bộ container ra host (`host.docker.internal:3099`) và mock server chưa được cấu hình làm default provider trong `cordis.patch.yml`. Theo đúng nguyên tắc kiểm thử nghiêm ngặt, kịch bản này được đánh dấu **SKIP** và **không tính PASS E2E** cho đến khi có provider thật hoặc mock provider hoàn chỉnh được cấu hình chính thức.

---

## 3. Danh sách ảnh chụp màn hình bằng chứng (Screenshots)

- **1. `01_unauthenticated_redirect_login.png`**: Truy cập chưa xác thực tự động chuyển hướng sang trang /login
- **2. `02_alice_login_success.png`**: Đăng nhập Alice thành công, vào giao diện chính DSH
- **3. `03_alice_workspace_view.png`**: Thanh User bar hiển thị test_alice và cây thư mục workspace được cô lập
- **4. `04_alice_attachment_uploaded.png`**: Tải tài liệu vào session của Alice thành công và lưu vết attachment
- **5. `05_alice_session_composer.png`**: Vùng soạn thảo (composer) sẵn sàng tương tác trong session
- **6. `06_alice_after_refresh_f5.png`**: Sau khi F5 (reload), phiên làm việc và tài liệu của Alice còn nguyên vẹn
- **7. `07_alice_new_session_clean.png`**: Tạo New Session tiếp theo cho Alice với composer sạch sẽ
- **8. `08_after_logout.png`**: Đăng xuất thành công, xóa sạch token trong localStorage, trở về màn hình login
- **9. `09_bob_isolated_view.png`**: Bob đăng nhập trên cùng trình duyệt: chỉ thấy workspace của Bob, không thấy dữ liệu Alice
- **10. `10_bob_cross_session_blocked.png`**: Bob truy cập session và attachment của Alice bị từ chối 403 Forbidden
- **11. `11_alice_restored_intact.png`**: Đăng nhập lại Alice: toàn bộ session và attachment trước đó được bảo toàn nguyên trạng

---

## 4. Xác nhận an toàn & Bàn giao Bước 6
- Không có rò rỉ session hoặc dữ liệu giữa các người dùng khi sử dụng chung một trình duyệt.
- DSH Docker 3090 duy trì test endpoint bị tắt (HTTP 403 Forbidden).
- DSH Windows 3088 PID 27324 hoạt động bình thường, không suy suyển.
- Không sử dụng API key thật hay dịch vụ bên ngoài.

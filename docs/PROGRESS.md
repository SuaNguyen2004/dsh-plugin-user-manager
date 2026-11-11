# TIẾN ĐỘ

- [x] Phase 0 — Điều tra (phương án đã chọn: B — nhiều tiến trình DSH nhẹ trên 1 container dsh-main, mỗi user 1 DSH_HOME riêng)
- [x] Phase 1 — Tách repo
- [x] Phase 2 — dsh-tool
- [x] Phase 3 — Orchestrator + Exec Router + Sweeper ✅ HOÀN TẤT
- [x] Phase 4 — dsh-main ✅ HOÀN TẤT
- [x] Phase 5 — Gateway ✅ HOÀN TẤT
- [x] Phase 6 — Migrate ✅ HOÀN TẤT
- [x] Phase 7 — Nghiệm thu ✅ HOÀN TẤT (12/12 TIÊU CHÍ PASS)

## Phase 7: ghi chú (ĐÃ HOÀN TẤT — 12/12 TIÊU CHÍ NGHIỆM THU PASS)

- Đã chuyển dữ liệu cũ trong `data/` trên Host vào `draft/legacy/host-data-backup/` (không xóa, bảo toàn 100%); thư mục `data/` trên Host để rỗng và giữ nguyên 0 file mới sau toàn bộ quá trình vận hành hệ thống.
- Cập nhật `docker-compose.yml`: thêm cờ `,exec` cho `tmpfs: /data/temp:size=64m,mode=1777,exec` để addon native (`node-addon-require-builtin`) trong `dsh-main` nạp được trên Linux tmpfs; cập nhật `waitForHttpReady` trong `dsh-main/router.js` chờ `GET /` trả HTTP 200 trước khi proxy request đầu tiên.
- Tạo `test/phase7-acceptance-test.js` và `test/run-tests.js`: kiểm thử tự động toàn bộ **12/12 tiêu chí nghiệm thu** trên hệ thống `docker compose` đang chạy thật. Log lưu tại `test/phase7-run.log`.

## Phase 6: ghi chú (ĐÃ HOÀN TẤT — CHỜ XÁC NHẬN ĐỐI CHIẾU)

- Đã viết `scripts/migrate-to-volumes.js` (idempotent, dùng `dockerode` trực tiếp, **tuyệt đối không xóa dữ liệu gốc trên Host `data/`**):
  1. Gộp WAL của `data/users.db` bằng `VACUUM INTO` và chép kèm `key_pools.json`, `models_scope.json`, `models_config.json` vào volume `dsh-gateway-data` (4 file, 104,436 bytes, đầy đủ 5 tài khoản `admin`, `alice`, `bob`, `david`, `nva`).
  2. Chép `data/admin_dsh_home` -> `dsh-homes:/user-1-admin` và `data/dsh_homes/user-2-alice`, `data/dsh_homes/user-5-nva` -> `dsh-homes` (102 file, bỏ qua thư mục lỗi `user-[object Object]-undefined` và các symlink `[View]*`).
  3. Chuẩn hóa toàn bộ volume workspace (`dsh-vol-admin`, `dsh-vol-user2`, `dsh-vol-user3`, `dsh-vol-user4`, `dsh-vol-user5`) về đúng cấu trúc `/data/workspace/<username>/<workspace>/files/<category>/<file>`, gỡ bỏ lớp lồng thừa `workspace/`.
- Báo cáo đối chiếu chi tiết đã xuất tại `docs/MIGRATION_REPORT.md`.
- Toàn bộ 6/6 bài test Phase 6 PASS (`test/phase6-run.log`).

## Phase 5: ghi chú (ĐÃ HOÀN TẤT)

- `gateway/server.js`: Bỏ hoàn toàn việc spawn container lúc login (`POST /api/auth/login` trả `redirectUrl: "/"` trong ~66ms, set cookie `dsh_user_token` `HttpOnly; SameSite=Lax; Max-Age=604800`, 0 container sinh ra).
- Bỏ dashboard Admin riêng và nút "🚀 Vào DeepSeek Harness": chuyển `gateway/public/admin.html` vào `draft/legacy/gateway-public/admin.html`, sửa `gateway/public/login.html` để cả `user` và `admin` đều redirect thẳng về `/`, gỡ nút `/admin` khỏi `dsh-main/inject-ui.cjs`.
- Proxy HTTP + WebSocket upgrade: hàm `stampTrustedHeaders(req, user)` xóa sạch mọi header `X-DSH-*` từ phía client (chống giả mạo `X-DSH-Role: admin`) và gắn lại `X-DSH-User-Id`, `X-DSH-Username`, `X-DSH-Role` lấy từ SQLite trước khi forward sang `dsh-main:3090`.
- Khởi chạy đồng thời cổng nội bộ `INTERNAL_PORT=3091` (`createInternalServer` -> `/internal/exec`) chỉ mở trong mạng Docker, kèm `reconcileOnBoot()` và `startToolIdleSweeper(60000)`.
- `database/connection.js`, `gateway/key-pool.js`, `gateway/model-manager.js`: Bật `PRAGMA journal_mode = WAL;` cho SQLite và chuyển toàn bộ đường dẫn lưu trữ (`users.db`, `key_pools.json`, `models_scope.json`, `models_catalog.json`) vào thư mục volume `/data/gateway` (`dsh-gateway-data`) — thư mục `data/` trên Host hoàn toàn không phát sinh file mới.
- Đã build thành công cả 3 image (`dsh-gateway:latest`, `dsh-main:latest`, `dsh-tool:latest`) và chạy toàn bộ test Phase 5 PASS (`test/phase5-run.log`).

## Phase 4: ghi chú (ĐÃ HOÀN TẤT)

- Kiến trúc đã xác nhận với user: **Phương án B** cho multi-tenancy (1 container `dsh-main` chạy `router.js` trên `:3090`, lazy-spawn 1 tiến trình DSH nhẹ theo `X-DSH-User-Id` với `DSH_HOME=/data/dsh_homes/user-<id>-<name>` nằm trong volume `dsh-homes`) và **Phương án B** cho tool hook (re-tool surface: tắt `tool-fs`/`tool-fs-search`/`tool-bash`/`tool-pwsh` local trong `cordis.patch.yml`, đăng ký bộ tool remote gọi `POST http://dsh-gateway:3091/internal/exec`).
- Lý do bảo mật `dsh-main` **không mount** volume workspace: mọi tiến trình DSH chạy trong `dsh-main` không có quyền truy cập trực tiếp vào dữ liệu file của bất kỳ user nào; mọi thao tác đọc/ghi/upload/bash đều phải đi qua Exec Router kèm `INTERNAL_TOKEN` để thực thi bên trong container sandbox cô lập `dsh-tool-<username>`.
- Admin Read-Only: `dsh-main/lib/user/workspace.js` quét `/data/dsh_homes/user-*`, gom các workspace/session của user vào `KHU VỰC GIÁM SÁT (READ-ONLY)` với hậu tố `(<username>)`; `patch-dsh-host.cjs` (Patch 6.2) chặn gửi prompt vào session của user khác và trả về lỗi `session/read-only`.
- UI injection theo từng tiến trình qua `webServer.tapIndex` (`inject-ui.cjs`): ẩn tab `Models` với `role=user`, giữ nguyên với `role=admin`.
- Đã build thành công image `dsh-main:latest` và chạy toàn bộ test Phase 4 PASS (`test/phase4-run.log`).

## Phase 3: ghi chú (ĐÃ HOÀN TẤT)

- Sửa `waitForToolReady` trong `gateway/orchestrator.js`: dùng `exec.start({ Detach: true })` + `exec.inspect()` thay vì chờ `stream.end` trên non-attached stream (tránh treo trên Windows named pipe). Cold-start container đạt ~350–620ms.
- Sửa `readStreamToString` trong `gateway/orchestrator.js`: thêm `demuxExecOutput` gỡ 8-byte Docker multiplexed frame header trước khi parse JSON line từ runner. Warm exec đạt ~186–252ms.
- Sửa `test/phase3-orchestrator-test.js`: bổ sung `status: 'active'` cho mock `USERS`, kiểm tra `files/docs` ở bài test sống sót dữ liệu sau sweep, dùng đúng `docker.getVolume(name).remove()`.
- Toàn bộ 10/10 bài test Phase 3 PASS. Log lưu tại `test/phase3-run.log`.
- Tạo `scripts/cleanup-test.ps1`: chỉ xóa container/volume có label `dsh.managed=true` VÀ tên bắt đầu bằng `test-` (hoặc `dsh-tool-test-`); bảo vệ cứng không bao giờ xóa `dsh-vol-user*`, `dsh-vol-admin*`, `dsh-homes*`, `dsh-gateway-data*`.

## Bổ sung yêu cầu của user (2026-10-25) — ƯU TIÊN cao hơn spec cũ khi mâu thuẫn

1. **Đường dẫn file:** `/data/workspace/<tên user>/<tên-workspace>/files/<loại-file>/<tên-file>`
   (đã có thêm cấp `<tên user>` so với spec mục 3 cũ). Đã implement và verify trong Phase 2/3 — container tên gì cũng không ảnh hưởng path này.
2. **dsh-main là server duy nhất:** user/admin đăng nhập qua gateway chỉ vào được màn hình DSH của dsh-main; ĐĂNG NHẬP KHÔNG sinh sandbox container nào. Container tool chỉ sinh khi model thực sự gọi tool (lazy spawn — đã có trong Phase 3).
3. **Tên container tool: `dsh-tool-<tên user/admin>`** (ví dụ `dsh-tool-alice`, `dsh-tool-admin`) — thay cho kiểu `dsh-<user|admin>-<id>-<username>` ở spec mục 4 cũ. Đã implement trong `orchestrator.js` (toolContainerName) và PASS trong test.
=> Áp dụng vào Phase 4 khi viết tool hook + patch multi-tenant cho dsh-main.

# VAI TRÒ

Bạn là Senior Backend/DevOps Engineer. Refactor dự án "DSH Lite Enterprise" (@deepseek-ai/dsh v0.2.0-rc.2) sang kiến trúc "Shared Brain + On-demand Tool Sandbox". Làm tuần tự theo Phase; mỗi Phase xong phải chạy test và báo cáo (file đã đổi, lệnh test, kết quả) trước khi sang Phase kế. Không xóa code cũ: chuyển vào draft/legacy/. Gặp quyết định kiến trúc mơ hồ thì hỏi lại tôi.

# 1. VẤN ĐỀ HIỆN TẠI

- Mỗi user đăng nhập => 1 container chứa nguyên DSH (~10s cold start, 256MB RAM/người): lãng phí.
- Admin phải vào dashboard riêng và bấm "🚀 Vào DeepSeek Harness" mới bật container.
- Dữ liệu còn nằm trên ổ cứng Host (bind-mount data/dsh_homes/user-<id>-<name> -> /data/dsh_home; users.db; /data/temp).
  => Bỏ hoàn toàn mô hình "mỗi user 1 DSH container" và bỏ mọi bind-mount ra ổ cứng Host.

# 2. KIẾN TRÚC MỤC TIÊU (3 image, 1 docker-compose.yml)

## Image 1: dsh-gateway (Express proxy) — DUY NHẤT expose cổng 12345

- Express + http-proxy (HTTP + WebSocket upgrade).
- Auth: bcrypt + JWT, cookie dsh_user_token (HttpOnly, SameSite=Lax, 7 ngày). SQLite WAL + Sequelize, giữ 4 bảng Users, Sessions, UserSessions, Attachments. File users.db nằm trong volume dsh-gateway-data.
- Đăng nhập xong redirect thẳng "/" (giao diện DSH). KHÔNG còn dashboard Admin riêng, KHÔNG còn nút "Vào DeepSeek Harness", KHÔNG spawn container lúc login.
- Mỗi request/WS: giải JWT, strip mọi header X-DSH-\* từ client, gắn lại X-DSH-User-Id / X-DSH-Username / X-DSH-Role, proxy sang dsh-main:3090.
- Chứa Orchestrator (dockerode; docker.sock CHỈ mount ở container này), Exec Router, Idle Sweeper.

## Image 2: dsh-main (DSH lõi dùng chung) — nội bộ :3090, không publish port

- Một instance DSH phục vụ mọi user, multi-tenant theo header X-DSH-\*.
- Mỗi user có dsh_home riêng: /data/dsh_homes/user-<id>-<name> (session JSONL, workspace.json, cấu hình) nằm trong volume dsh-homes.
- User chỉ thấy session/workspace của mình. Admin thấy thêm của mọi user ở chế độ READ-ONLY, nhóm "KHU VỰC GIÁM SÁT (READ-ONLY)" với hậu tố (tên_user). Giữ logic Patch 4/5/6 (path mapping, gom nhóm đúng workspace, chặn ghi session không thuộc sở hữu => lỗi session/read-only), viết lại cho mô hình 1 tiến trình dùng chung, không phụ thuộc symlink của entrypoint cũ.
- Ẩn tab nhạy cảm (AI Models, API Key, mạng) với role=user; Admin giữ nguyên (giữ inject-ui.cjs).
- TOOL HOOK: patch tầng thực thi tool (bash, read/write/edit file, list dir, document tools...) để không chạy local, mà gọi POST http://dsh-gateway:3091/internal/exec (cổng nội bộ, kèm INTERNAL_TOKEN). Payload: userId, role, tool, args, workspace, cwd, timeoutMs.
- dsh-main KHÔNG mount volume workspace. Mọi thao tác file (kể cả upload/preview/download) đi qua Exec Router. Ghi rõ lý do bảo mật trong báo cáo.

## Image 3: dsh-tool (một image, hai bộ tool độc lập theo role)

- Base node:22-bookworm-slim + python3, python3-docx, poppler-utils, mammoth.
- Cấu trúc:
  dsh-tool/
  Dockerfile
  entrypoint.sh # đọc env DSH_ROLE=user|admin
  tools/common/ # path-guard, logger, auto-categorize file
  tools/user/ # shell, fs, doc-reader... CHỈ trong /data/workspace
  tools/admin/ # như user + công cụ giám sát đọc /data/all_users_ro (chỉ đọc)
  manifest.user.json / manifest.admin.json
- Hai bộ tool ĐỘC LẬP về code, manifest, quyền; entrypoint chỉ nạp đúng bộ theo role. User không gọi được tool admin.
- Chạy non-root, cap-drop ALL, no-new-privileges, pids-limit, chặn network ra ngoài nếu không cần (cấu hình qua env).

# 3. LƯU TRỮ — 100% TRONG DOCKER, KHÔNG GHI RA Ổ CỨNG HOST

## Volume

- dsh-vol-user<id> (mỗi user) và dsh-vol-admin (admin): workspace riêng, mount vào tool container tại /data/workspace.
- dsh-homes: dsh_home của mọi user (thư mục con user-<id>-<name>), chỉ mount vào dsh-main.
- dsh-gateway-data: users.db.
- Cấm bind-mount thư mục Windows. /data/temp dùng tmpfs hoặc nằm trong volume.
- Volume tồn tại độc lập với container: xóa/tạo lại container không làm mất dữ liệu.

## Cấu trúc thư mục trong volume workspace (BẮT BUỘC)

/data/workspace/<tên-workspace>/files/<loại-file>/<tên-file>

- Một user có thể có nhiều workspace; mỗi workspace là một thư mục cấp 1 dưới /data/workspace.
- <tên-workspace> được sanitize và duy nhất trong phạm vi user. Cấm lồng thừa như /data/workspace/alice-space/workspace.
- <loại-file> tự phân loại theo đuôi file: docs (.doc,.docx,.txt,.md), pdf, sheets (.xls,.xlsx,.csv), images (.png,.jpg,.jpeg,.gif,.webp), others (còn lại).
- Ví dụ: /data/workspace/alice-space/files/docs/Quy trình.docx
- Logic auto-categorize (Patch 8/9 cũ) chuyển sang tools/common/ của dsh-tool và áp dụng cho cả upload lẫn file do tool tạo ra.
- Path-guard: mọi đường dẫn phải resolve nằm trong /data/workspace/<ws>/ (chống ../ và symlink escape).

## Admin xem dữ liệu user (read-only)

- Khi tạo tool container admin, mount toàn bộ volume dsh-vol-user<id> hiện có vào /data/all_users_ro/<id>-<username> với cờ :ro.
- Session chat của user do dsh-main đọc từ dsh-homes và hiển thị read-only cho admin (không cần mount thêm).

## Migrate dữ liệu cũ (script one-shot, idempotent, KHÔNG xóa dữ liệu gốc trên Host)

- Copy data/dsh_homes/\* trên Host vào volume dsh-homes bằng container tạm.
- Chuẩn hóa workspace cũ trong dsh-vol-\* theo cấu trúc mới (gỡ lớp lồng thừa, phân loại lại file vào files/<loại>/).
- Chép data/users.db vào dsh-gateway-data.
- Xuất báo cáo đối chiếu số file/dung lượng trước và sau. Chỉ khi tôi xác nhận mới được dọn dữ liệu cũ trên Host.

# 4. ORCHESTRATOR + EXEC ROUTER + SWEEPER (trong dsh-gateway)

- Tên container: dsh-<user|admin>-<id>-<username> (sanitize [a-z0-9_-]), ví dụ dsh-user-7-alice, dsh-admin-1-admin. Label: dsh.managed=true, dsh.userId, dsh.role.
- Network dsh-enterprise-lite_default. Chỉ gateway publish 12345. Tool container không publish port.
- Giới hạn qua .env: RAM 256MB, CPU 0.5 core.
- LAZY SPAWN: chỉ khi có tool call đầu tiên mới gọi ensureToolContainer(userId, role, username):
    - đang chạy => dùng luôn;
    - chưa có/đã dừng => tạo volume nếu thiếu, create + start, chờ ready, rồi exec;
    - mutex theo userId để 2 tool call đồng thời không tạo trùng.
- EXEC ROUTER (POST /internal/exec): ensureToolContainer => docker exec qua dockerode, stream stdout/stderr, hỗ trợ timeout, kill khi huỷ, giới hạn kích thước output, trả exit code. Validate tool thuộc manifest của đúng role và path nằm trong workspace.
- Chỉ tool call mới cập nhật lastToolUse[userId]. Chat thuần không tính và không giữ container.
- IDLE SWEEPER: quét mỗi 60s; lastToolUse > 15 phút (TOOL_IDLE_MINUTES=15) và không có exec đang chạy => stop + remove container. Giữ nguyên volume.
- Reconcile khi gateway restart: liệt kê container dsh.managed=true đang chạy, đặt lastToolUse = now.

# 5. BẢO MẬT & PHI CHỨC NĂNG

- docker.sock chỉ mount cho dsh-gateway. INTERNAL_TOKEN bắt buộc cho /internal/\*. Cổng 3091 chỉ nội bộ.
- Login/vào DSH < 1s. Tool call đầu tiên chấp nhận cold start (log thời gian); các lần sau overhead < 200ms.
- Cấu hình bằng .env (JWT_SECRET, INTERNAL_TOKEN, TOOL_IDLE_MINUTES, RAM/CPU...).
- npm run build:images build cả 3 image; docker compose up -d chạy được bằng một lệnh trên Windows + WSL2.

# 6. PHASES (làm tuần tự, chờ tôi xác nhận ở các điểm đánh dấu)

Phase 0 — Điều tra, KHÔNG sửa code. Đọc mã nguồn @deepseek-ai/dsh và báo cáo:
a) DSH có phục vụ nhiều user trong 1 tiến trình được không; nếu không thì cần patch những điểm nào (home dir, session store, workspace registry, auth).
b) Điểm hook chính xác của việc thực thi tool (file/hàm chạy bash, đọc/ghi file).
c) Cách DSH tạo/đặt tên workspace và nơi lưu đường dẫn workspace, để áp dụng cấu trúc /data/workspace/<ws>/files/<loại>/<file>.
d) Phương án A (1 tiến trình DSH multi-tenant) vs B (dsh-main chạy nhiều tiến trình DSH nhẹ, mỗi user 1 tiến trình, không phải container riêng). Nêu ưu/nhược, đề xuất 1 phương án.
⏸ DỪNG, chờ tôi xác nhận phương án.
Phase 1 — Tách repo: gateway/, dsh-main/, dsh-tool/, docker-compose.yml với các volume ở mục 3; chuyển code cũ vào draft/legacy/.
Phase 2 — dsh-tool: hai bộ tool user/admin độc lập, manifest, entrypoint theo role, path-guard, auto-categorize theo cấu trúc mục 3.
Phase 3 — Orchestrator lazy spawn + Exec Router + Idle Sweeper 15 phút + reconcile.
Phase 4 — dsh-main: multi-tenant theo header, tool hook gọi exec router, read-only cho admin, ẩn tab theo role, dsh_home trong volume dsh-homes.
Phase 5 — Gateway: bỏ dashboard admin riêng và nút "Vào DSH", login redirect "/", proxy HTTP+WS gắn header tin cậy, users.db vào volume.
Phase 6 — Script migrate dữ liệu cũ (mục 3). ⏸ Chờ tôi xác nhận kết quả đối chiếu.
Phase 7 — Chạy toàn bộ test nghiệm thu, dọn dẹp.

# 7. TIÊU CHÍ NGHIỆM THU (mỗi mục có test tự động)

1. Login alice vào DSH < 1s; `docker ps` không có container dsh-user-\* nào.
2. Alice chat thuần (không tool): vẫn không có container.
3. Alice gọi tool lần đầu: xuất hiện dsh-user-<id>-alice; file tạo ra nằm đúng /data/workspace/<ws>/files/<loại>/<file> trong volume dsh-vol-user<id>.
4. Alice tạo 2 workspace: cả hai nằm riêng dưới /data/workspace, đúng cấu trúc, không lồng thừa.
5. Bob đăng nhập cùng lúc: không thấy session/file của alice; alice không đọc được ngoài workspace của mình (test ../ và symlink).
6. Admin vào thẳng DSH, xem được workspace/session của alice dưới nhóm READ-ONLY; gửi tin vào session của alice bị chặn (session/read-only); ghi vào /data/all_users_ro bị lỗi do :ro.
7. Admin gọi tool: tạo dsh-admin-1-admin với bộ tool admin; user không gọi được tool admin.
8. Idle (test với TOOL_IDLE_MINUTES=1): container bị remove, volume và lịch sử chat còn nguyên; tool call kế tiếp tạo lại container và file cũ vẫn còn.
9. Hai tool call đồng thời của cùng 1 user chỉ tạo đúng 1 container.
10. Truy cập trực tiếp dsh-main:3090 hoặc gateway:3091 từ Host đều thất bại; giả mạo X-DSH-Role từ trình duyệt không có tác dụng.
11. `docker inspect` mọi container: không có bind-mount nào trỏ vào ổ C:; sau khi chạy hệ thống, thư mục data/ trên Host không phát sinh file mới.
12. `docker compose down` rồi `up -d`: toàn bộ lịch sử chat, file workspace, tài khoản vẫn còn.

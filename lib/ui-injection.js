/**
 * Helper to generate injected CSS & JS script into DSH native index.html
 */
export function getNativeInjectionMarkup() {
  return `
<!-- DSH User Manager: Native UI Integration -->
<style id="dsh-user-manager-style">
  :root {
    --dum-bg-glass: rgba(18, 22, 34, 0.88);
    --dum-bg-card: #161b26;
    --dum-border: rgba(255, 255, 255, 0.12);
    --dum-accent: #3b82f6;
    --dum-accent-glow: rgba(59, 130, 246, 0.35);
    --dum-text: #f3f4f6;
    --dum-text-muted: #9ca3af;
    --dum-success: #10b981;
    --dum-warning: #f59e0b;
    --dum-danger: #ef4444;
  }

  /* Guest Banner */
  #dum-guest-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 38px;
    background: linear-gradient(90deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98));
    border-bottom: 1px solid rgba(245, 158, 11, 0.3);
    color: #cbd5e1;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: none;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 99999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  #dum-guest-banner.active {
    display: flex;
  }
  .dum-banner-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dum-badge-guest {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.4);
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .dum-banner-actions {
    display: flex;
    gap: 8px;
  }
  .dum-btn {
    border: none;
    outline: none;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s ease;
  }
  .dum-btn-primary {
    background: var(--dum-accent);
    color: #fff;
  }
  .dum-btn-primary:hover {
    background: #2563eb;
    box-shadow: 0 0 10px var(--dum-accent-glow);
  }
  .dum-btn-outline {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
    border: 1px solid var(--dum-border);
  }
  .dum-btn-outline:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Admin & User Top Floating Bar */
  #dum-user-bar {
    position: fixed;
    top: 12px;
    right: 18px;
    display: none;
    align-items: center;
    gap: 10px;
    z-index: 99998;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid var(--dum-border);
    padding: 5px 12px;
    border-radius: 20px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #dum-user-bar.active {
    display: flex;
  }
  .dum-user-name {
    font-size: 12px;
    color: #e2e8f0;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dum-quota-pill {
    font-size: 11px;
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 8px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .dum-btn-admin {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 12px;
    cursor: pointer;
    border: none;
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);
    transition: transform 0.15s ease;
  }
  .dum-btn-admin:hover {
    transform: scale(1.04);
  }

  /* Global Modals (Auth & Admin) */
  .dum-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    z-index: 100000;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .dum-modal-backdrop.open {
    display: flex;
  }
  .dum-modal-card {
    background: var(--dum-bg-card);
    border: 1px solid var(--dum-border);
    border-radius: 14px;
    width: 420px;
    max-width: 92vw;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: var(--dum-text);
    animation: dumFadeIn 0.2s ease-out;
  }
  .dum-modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--dum-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .dum-modal-title {
    font-size: 16px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dum-modal-close {
    background: transparent;
    border: none;
    color: var(--dum-text-muted);
    font-size: 20px;
    cursor: pointer;
  }
  .dum-modal-close:hover { color: #fff; }
  .dum-modal-body {
    padding: 20px;
  }
  .dum-form-group {
    margin-bottom: 14px;
  }
  .dum-form-group label {
    display: block;
    font-size: 12px;
    color: var(--dum-text-muted);
    margin-bottom: 6px;
  }
  .dum-form-input {
    width: 100%;
    padding: 9px 12px;
    border-radius: 8px;
    background: #0f131a;
    border: 1px solid var(--dum-border);
    color: #fff;
    font-size: 13px;
    box-sizing: border-box;
  }
  .dum-form-input:focus {
    outline: none;
    border-color: var(--dum-accent);
    box-shadow: 0 0 8px var(--dum-accent-glow);
  }
  .dum-alert {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    margin-bottom: 12px;
    display: none;
  }
  .dum-alert-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }
  .dum-alert-success {
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.4);
    color: #6ee7b7;
  }

  /* Admin Modal (Wide Slide-over / Large) */
  .dum-admin-card {
    width: 820px;
    max-width: 95vw;
    height: 80vh;
    display: flex;
    flex-direction: column;
  }
  .dum-admin-tabs {
    display: flex;
    background: #0d1117;
    border-bottom: 1px solid var(--dum-border);
    padding: 0 16px;
  }
  .dum-tab-btn {
    background: transparent;
    border: none;
    color: var(--dum-text-muted);
    padding: 12px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .dum-tab-btn.active {
    color: var(--dum-accent);
    border-bottom-color: var(--dum-accent);
  }
  .dum-admin-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  .dum-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .dum-table th, .dum-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .dum-table th {
    background: rgba(0, 0, 0, 0.2);
    color: var(--dum-text-muted);
    font-weight: 600;
  }
  .dum-status-tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
  .dum-tag-pending { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
  .dum-tag-active { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
  .dum-tag-rejected { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }

  @keyframes dumFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
</style>

<!-- Guest Notification Banner -->
<div id="dum-guest-banner">
  <div class="dum-banner-left">
    <span class="dum-badge-guest">Khách (Guest)</span>
    <span>Bạn đang dùng chế độ Khách — Lịch sử chat sẽ không được lưu vĩnh viễn.</span>
  </div>
  <div class="dum-banner-actions">
    <button class="dum-btn dum-btn-outline" onclick="window.dumShowAuth('login')">Đăng nhập</button>
    <button class="dum-btn dum-btn-primary" onclick="window.dumShowAuth('register')">Đăng ký để lưu</button>
  </div>
</div>

<!-- Floating Top Status Bar for Logged-in User & Admin -->
<div id="dum-user-bar">
  <span class="dum-user-name" id="dum-bar-username">👤 User</span>
  <span class="dum-quota-pill" id="dum-bar-quota">Quota: 100k</span>
  <button class="dum-btn-admin" id="dum-btn-open-admin" style="display:none;" onclick="window.dumOpenAdmin()">👑 Quản lý tài khoản</button>
  <button class="dum-btn dum-btn-outline" style="padding: 2px 8px; font-size: 11px;" onclick="window.dumLogout()">Đăng xuất</button>
</div>

<!-- Modal: Auth (Login & Register) -->
<div id="dum-modal-auth" class="dum-modal-backdrop">
  <div class="dum-modal-card">
    <div class="dum-modal-header">
      <div class="dum-modal-title" id="dum-auth-title">Đăng nhập</div>
      <button class="dum-modal-close" onclick="window.dumCloseAuth()">&times;</button>
    </div>
    <div class="dum-modal-body">
      <div id="dum-auth-alert" class="dum-alert"></div>
      <div class="dum-form-group">
        <label>Tên đăng nhập (Username):</label>
        <input type="text" id="dum-input-username" class="dum-form-input" placeholder="Nhập username" autocomplete="username">
      </div>
      <div class="dum-form-group">
        <label>Mật khẩu (Password):</label>
        <input type="password" id="dum-input-password" class="dum-form-input" placeholder="Nhập mật khẩu" autocomplete="current-password">
      </div>
      <button id="dum-btn-submit-auth" class="dum-btn dum-btn-primary" style="width: 100%; padding: 10px; margin-top: 8px;" onclick="window.dumSubmitAuth()">Đăng nhập</button>
      <div style="text-align: center; margin-top: 14px; font-size: 12px; color: var(--dum-text-muted);">
        <span id="dum-auth-toggle-hint">Chưa có tài khoản?</span>
        <a href="javascript:void(0)" id="dum-auth-toggle-link" style="color: var(--dum-accent); text-decoration: none; margin-left: 4px;" onclick="window.dumToggleAuthMode()">Đăng ký ngay</a>
      </div>
    </div>
  </div>
</div>

<!-- Modal: Admin Management Dashboard -->
<div id="dum-modal-admin" class="dum-modal-backdrop">
  <div class="dum-modal-card dum-admin-card">
    <div class="dum-modal-header">
      <div class="dum-modal-title">👑 Bảng Điều Khiển Quản Trị Hệ Thống</div>
      <button class="dum-btn dum-btn-outline" onclick="window.dumCloseAdmin()">⬅️ Quay lại DSH</button>
    </div>
    <div class="dum-admin-tabs">
      <button class="dum-tab-btn active" id="dum-tab-pending-btn" onclick="window.dumSwitchTab('pending')">⏳ Chờ duyệt (<span id="dum-pending-count">0</span>)</button>
      <button class="dum-tab-btn" id="dum-tab-all-btn" onclick="window.dumSwitchTab('all')">👥 Tất cả thành viên</button>
    </div>
    <div class="dum-admin-content">
      <div id="dum-tab-pending-content">
        <table class="dum-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Ngày đăng ký</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody id="dum-pending-table-body">
            <tr><td colspan="4" style="text-align:center; color:#888;">Đang tải...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="dum-tab-all-content" style="display:none;">
        <table class="dum-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Đã dùng / Hạn mức</th>
              <th>Thao tác Quota</th>
            </tr>
          </thead>
          <tbody id="dum-all-table-body">
            <tr><td colspan="6" style="text-align:center; color:#888;">Đang tải...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script id="dsh-user-manager-script">
(function() {
  let currentUser = null;
  let authMode = 'login'; // 'login' | 'register'

  // Fetch session status on page load
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        renderLoggedInUI();
      } else {
        currentUser = null;
        renderGuestUI();
      }
    } catch (err) {
      currentUser = null;
      renderGuestUI();
    }
  }

  function renderGuestUI() {
    const banner = document.getElementById('dum-guest-banner');
    const userBar = document.getElementById('dum-user-bar');
    if (banner) banner.classList.add('active');
    if (userBar) userBar.classList.remove('active');
    // Offset body to prevent banner overlapping DSH top menu
    document.body.style.paddingTop = '38px';
  }

  function renderLoggedInUI() {
    const banner = document.getElementById('dum-guest-banner');
    const userBar = document.getElementById('dum-user-bar');
    if (banner) banner.classList.remove('active');
    document.body.style.paddingTop = '0px';

    if (userBar && currentUser) {
      userBar.classList.add('active');
      document.getElementById('dum-bar-username').textContent = (currentUser.role === 'admin' ? '👑 ' : '👤 ') + currentUser.username;
      
      const usedK = Math.round((currentUser.tokens_used || 0) / 1000);
      const totalK = Math.round((currentUser.token_quota || 100000) / 1000);
      document.getElementById('dum-bar-quota').textContent = 'Quota: ' + usedK + 'k/' + totalK + 'k';

      const adminBtn = document.getElementById('dum-btn-open-admin');
      if (adminBtn) {
        adminBtn.style.display = currentUser.role === 'admin' ? 'inline-block' : 'none';
      }
    }
  }

  window.dumShowAuth = function(mode) {
    authMode = mode || 'login';
    const modal = document.getElementById('dum-modal-auth');
    const title = document.getElementById('dum-auth-title');
    const submitBtn = document.getElementById('dum-btn-submit-auth');
    const hint = document.getElementById('dum-auth-toggle-hint');
    const link = document.getElementById('dum-auth-toggle-link');
    const alert = document.getElementById('dum-auth-alert');

    alert.style.display = 'none';
    if (authMode === 'login') {
      title.textContent = 'Đăng nhập DeepSeek Harness';
      submitBtn.textContent = 'Đăng nhập';
      hint.textContent = 'Chưa có tài khoản?';
      link.textContent = 'Đăng ký ngay';
    } else {
      title.textContent = 'Đăng ký tài khoản DSH';
      submitBtn.textContent = 'Gửi yêu cầu đăng ký';
      hint.textContent = 'Đã có tài khoản?';
      link.textContent = 'Đăng nhập ngay';
    }
    modal.classList.add('open');
  };

  window.dumCloseAuth = function() {
    document.getElementById('dum-modal-auth').classList.remove('open');
  };

  window.dumToggleAuthMode = function() {
    window.dumShowAuth(authMode === 'login' ? 'register' : 'login');
  };

  window.dumSubmitAuth = async function() {
    const username = document.getElementById('dum-input-username').value.trim();
    const password = document.getElementById('dum-input-password').value;
    const alert = document.getElementById('dum-auth-alert');

    if (!username || !password) {
      alert.className = 'dum-alert dum-alert-error';
      alert.textContent = 'Vui lòng điền đầy đủ tên đăng nhập và mật khẩu!';
      alert.style.display = 'block';
      return;
    }

    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!res.ok) {
        alert.className = 'dum-alert dum-alert-error';
        alert.textContent = data.error || 'Có lỗi xảy ra!';
        alert.style.display = 'block';
        return;
      }

      if (authMode === 'register') {
        alert.className = 'dum-alert dum-alert-success';
        alert.textContent = 'Đăng ký thành công! Tài khoản đang chờ Admin phê duyệt. Vui lòng liên hệ Admin để kích hoạt.';
        alert.style.display = 'block';
      } else {
        window.dumCloseAuth();
        currentUser = data.user;
        renderLoggedInUI();
        window.location.reload();
      }
    } catch (err) {
      alert.className = 'dum-alert dum-alert-error';
      alert.textContent = 'Không thể kết nối đến máy chủ!';
      alert.style.display = 'block';
    }
  };

  window.dumLogout = async function() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  };

  // Admin Management Functions
  window.dumOpenAdmin = function() {
    document.getElementById('dum-modal-admin').classList.add('open');
    window.dumSwitchTab('pending');
  };

  window.dumCloseAdmin = function() {
    document.getElementById('dum-modal-admin').classList.remove('open');
  };

  window.dumSwitchTab = async function(tab) {
    const tabPendingBtn = document.getElementById('dum-tab-pending-btn');
    const tabAllBtn = document.getElementById('dum-tab-all-btn');
    const contentPending = document.getElementById('dum-tab-pending-content');
    const contentAll = document.getElementById('dum-tab-all-content');

    if (tab === 'pending') {
      tabPendingBtn.classList.add('active');
      tabAllBtn.classList.remove('active');
      contentPending.style.display = 'block';
      contentAll.style.display = 'none';
      await loadPendingUsers();
    } else {
      tabAllBtn.classList.add('active');
      tabPendingBtn.classList.remove('active');
      contentAll.style.display = 'block';
      contentPending.style.display = 'none';
      await loadAllUsers();
    }
  };

  async function loadPendingUsers() {
    const tbody = document.getElementById('dum-pending-table-body');
    try {
      const res = await fetch('/api/admin/pending-users');
      const data = await res.json();
      const users = data.users || [];
      document.getElementById('dum-pending-count').textContent = users.length;

      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888; padding: 24px;">Hiện không có tài khoản nào chờ duyệt!</td></tr>';
        return;
      }

      tbody.innerHTML = users.map(u => \`
        <tr>
          <td>\${u.id}</td>
          <td><b>\${u.username}</b></td>
          <td>\${u.created_at || 'Mới đây'}</td>
          <td>
            <button class="dum-btn dum-btn-primary" style="background:#10b981; padding:3px 10px; margin-right:6px;" onclick="window.dumApprove('\${u.username}')">✅ Duyệt nhanh</button>
            <button class="dum-btn dum-btn-outline" style="color:#ef4444; border-color:#ef4444; padding:3px 10px;" onclick="window.dumReject('\${u.username}')">❌ Từ chối</button>
          </td>
        </tr>
      \`).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444;">Lỗi khi tải danh sách!</td></tr>';
    }
  }

  async function loadAllUsers() {
    const tbody = document.getElementById('dum-all-table-body');
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      const users = data.users || [];

      tbody.innerHTML = users.map(u => {
        const statusClass = u.status === 'active' ? 'dum-tag-active' : (u.status === 'pending' ? 'dum-tag-pending' : 'dum-tag-rejected');
        return \`
          <tr>
            <td>\${u.id}</td>
            <td><b>\${u.username}</b></td>
            <td>\${u.role}</td>
            <td><span class="dum-status-tag \${statusClass}">\${u.status}</span></td>
            <td>\${u.tokens_used.toLocaleString()} / \${u.token_quota.toLocaleString()}</td>
            <td>
              <button class="dum-btn dum-btn-outline" style="padding:2px 8px; font-size:11px; margin-right:4px;" onclick="window.dumChangeQuota('\${u.username}', \${u.token_quota})">✏️ Quota</button>
              <button class="dum-btn dum-btn-outline" style="padding:2px 8px; font-size:11px;" onclick="window.dumResetUsage('\${u.username}')">🔄 Reset</button>
            </td>
          </tr>
        \`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444;">Lỗi khi tải danh sách!</td></tr>';
    }
  }

  window.dumApprove = async function(username) {
    if (!confirm('Bạn có chắc muốn duyệt tài khoản "' + username + '"?')) return;
    const res = await fetch('/api/admin/approve-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (res.ok) {
      loadPendingUsers();
    } else {
      alert('Không thể duyệt tài khoản!');
    }
  };

  window.dumReject = async function(username) {
    if (!confirm('Bạn có chắc muốn từ chối tài khoản "' + username + '"?')) return;
    const res = await fetch('/api/admin/reject-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (res.ok) {
      loadPendingUsers();
    } else {
      alert('Không thể từ chối tài khoản!');
    }
  };

  window.dumChangeQuota = async function(username, currentQuota) {
    const val = prompt('Nhập hạn ngạch Quota mới cho "' + username + '":', currentQuota);
    if (!val) return;
    const quota = parseInt(val, 10);
    if (isNaN(quota) || quota < 0) return alert('Số không hợp lệ!');

    const res = await fetch('/api/admin/quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, quota })
    });
    if (res.ok) {
      loadAllUsers();
    } else {
      alert('Không thể cập nhật quota!');
    }
  };

  window.dumResetUsage = async function(username) {
    if (!confirm('Đặt lại tokens đã dùng của "' + username + '" về 0?')) return;
    const res = await fetch('/api/admin/reset-usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (res.ok) {
      loadAllUsers();
    } else {
      alert('Không thể reset usage!');
    }
  };

  // Run initial check
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAuth);
  } else {
    checkAuth();
  }
})();
</script>
`;
}

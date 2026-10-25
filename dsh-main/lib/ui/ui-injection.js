// dsh-container-base/lib/ui/ui-injection.js
// Client UI Injection for DeepSeek Harness:
// 1. User Profile badge & Logout Modal
// 2. Hide Models tab in Settings for regular users

export function getNativeInjectionMarkup(username = 'User', role = 'user') {
  const isAdmin = (role === 'admin' || username.toLowerCase() === 'admin');

  return `
<!-- DSH USER ENTERPRISE UI INJECTION -->
<style>
  /* 1. User Profile Pill Button at Top Right */
  #dsh-enterprise-user-btn {
    position: fixed;
    top: 10px;
    right: 56px;
    z-index: 99990;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(22, 27, 34, 0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 24px;
    padding: 5px 14px;
    color: #f0f6fc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: all 0.2s ease;
    user-select: none;
  }
  #dsh-enterprise-user-btn:hover {
    background: rgba(33, 38, 45, 0.98);
    border-color: #58a6ff;
    transform: translateY(-1px);
  }
  .dsh-user-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1f6feb, #8957e5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: bold;
    color: #fff;
  }
  .dsh-role-badge {
    padding: 2px 7px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .dsh-role-admin {
    background: rgba(56, 139, 253, 0.2);
    color: #58a6ff;
    border: 1px solid rgba(56, 139, 253, 0.4);
  }
  .dsh-role-user {
    background: rgba(35, 134, 54, 0.2);
    color: #3fb950;
    border: 1px solid rgba(35, 134, 54, 0.4);
  }

  /* 2. User Modal Overlay */
  #dsh-user-modal-overlay {
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    z-index: 999999;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .dsh-user-modal-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 14px;
    width: 90%;
    max-width: 380px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
    overflow: hidden;
    animation: dshModalFadeIn 0.18s ease-out;
  }
  @keyframes dshModalFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
  .dsh-modal-header {
    padding: 20px 24px 16px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .dsh-modal-title { font-size: 15px; font-weight: 600; color: #f0f6fc; }
  .dsh-modal-close {
    background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer; line-height: 1;
  }
  .dsh-modal-close:hover { color: #f0f6fc; }
  .dsh-modal-body { padding: 20px 24px; color: #e6edf3; }
  .dsh-profile-row {
    display: flex; align-items: center; gap: 14px; margin-bottom: 18px;
  }
  .dsh-modal-avatar {
    width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(135deg, #1f6feb, #8957e5);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: bold; color: #fff;
  }
  .dsh-meta-box {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 12px;
    margin-bottom: 20px;
    line-height: 1.6;
  }
  .dsh-modal-actions {
    display: flex; flex-direction: column; gap: 10px;
  }
  .dsh-btn {
    padding: 9px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
    cursor: pointer; border: 1px solid transparent; text-align: center; text-decoration: none;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: all 0.15s ease;
  }
  .dsh-btn-admin {
    background: rgba(56, 139, 253, 0.15); color: #58a6ff; border-color: rgba(56, 139, 253, 0.4);
  }
  .dsh-btn-admin:hover { background: #1f6feb; color: #fff; }
  .dsh-btn-logout {
    background: rgba(218, 54, 51, 0.15); color: #f85149; border-color: rgba(218, 54, 51, 0.4);
  }
  .dsh-btn-logout:hover { background: #da3633; color: #fff; }

  /* 4. Hide Models tab in Settings for regular users */
  ${!isAdmin ? `
  /* Hide Models item in Settings modal */
  [data-key="models"],
  [data-tab="models"],
  [aria-controls*="models" i] {
    display: none !important;
  }
  ` : ''}
</style>

<!-- USER BUTTON -->
<div id="dsh-enterprise-user-btn" onclick="openDshUserModal()">
  <div class="dsh-user-avatar">${username.charAt(0).toUpperCase()}</div>
  <span>${username}</span>
  <span class="dsh-role-badge ${isAdmin ? 'dsh-role-admin' : 'dsh-role-user'}">${isAdmin ? 'ADMIN' : 'USER'}</span>
</div>

<!-- USER PROFILE & LOGOUT MODAL -->
<div id="dsh-user-modal-overlay" onclick="onDshOverlayClick(event)">
  <div class="dsh-user-modal-card">
    <div class="dsh-modal-header">
      <div class="dsh-modal-title">Tài khoản & Phiên làm việc</div>
      <button class="dsh-modal-close" onclick="closeDshUserModal()">&times;</button>
    </div>
    <div class="dsh-modal-body">
      <div class="dsh-profile-row">
        <div class="dsh-modal-avatar">${username.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-size: 16px; font-weight: 700;">${username}</div>
          <div style="font-size: 12px; color: #8b949e; margin-top: 2px;">
            Vai trò: <span class="dsh-role-badge ${isAdmin ? 'dsh-role-admin' : 'dsh-role-user'}">${isAdmin ? 'ADMINISTRATOR' : 'USER'}</span>
          </div>
        </div>
      </div>

      <div class="dsh-meta-box">
        <div style="color: #8b949e;">Môi trường Sandbox:</div>
        <div style="color: #56d364; font-weight: 600;">Hardware Isolated Container</div>
        <div style="color: #8b949e; margin-top: 6px;">Giới hạn RAM: <strong style="color: #f0f6fc;">256 MB</strong></div>
        <div style="color: #8b949e;">Workspace: <code style="color: #58a6ff;">/data/workspace</code></div>
      </div>

      <div class="dsh-modal-actions">
        ${isAdmin ? `
          <a href="/admin" class="dsh-btn dsh-btn-admin">
            🛡️ Trang Quản trị Admin
          </a>
        ` : ''}
        <button class="dsh-btn dsh-btn-logout" onclick="performDshLogout()">
          🚪 Đăng xuất (Logout)
        </button>
      </div>
    </div>
  </div>
</div>

<script>
  function openDshUserModal() {
    const modal = document.getElementById('dsh-user-modal-overlay');
    if (modal) modal.style.display = 'flex';
  }

  function closeDshUserModal() {
    const modal = document.getElementById('dsh-user-modal-overlay');
    if (modal) modal.style.display = 'none';
  }

  function onDshOverlayClick(e) {
    if (e.target && e.target.id === 'dsh-user-modal-overlay') {
      closeDshUserModal();
    }
  }

  function performDshLogout() {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi DeepSeek Harness?')) return;
    try {
      localStorage.removeItem('dsh_user_token');
      localStorage.removeItem('dsh_user_info');
      document.cookie = 'dsh_user_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (e) {}
    window.location.href = '/login';
  }

  // 4. Hide Models tab in Settings for regular users
  ${!isAdmin ? `
  (function monitorAndHideModelsTab() {
    function hideElements() {
      // Find any element containing text 'Models' inside settings dialog/tabs
      const items = document.querySelectorAll('button, div, [role="tab"], li');
      items.forEach(el => {
        if (el.children.length <= 2 && el.textContent.trim() === 'Models') {
          // Verify it is inside a settings dialog or navigation
          const parent = el.closest('[role="dialog"], [class*="settings"], [class*="modal"]');
          if (parent || el.getAttribute('role') === 'tab') {
            el.style.display = 'none';
          }
        }
      });
    }

    setInterval(hideElements, 400);
    hideElements();
  })();
  ` : ''}
</script>
`;
}

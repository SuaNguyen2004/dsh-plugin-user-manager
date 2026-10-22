// dsh-container-base/inject-ui.cjs
// Injects Enterprise User Profile, Change Password Form, Logout Modal and Settings Guards into DSH Web Frontend

const fs = require('fs');
const path = require('path');

const targetIndex = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html';

if (!fs.existsSync(targetIndex)) {
  console.log('[inject-ui] Target index.html not found, skipping injection.');
  process.exit(0);
}

try {
  let html = fs.readFileSync(targetIndex, 'utf8');

  // Clean up any prior injection block for clean idempotent update
  if (html.includes('<!-- DSH USER ENTERPRISE UI INJECTION -->')) {
    html = html.replace(/<!-- DSH USER ENTERPRISE UI INJECTION -->[\s\S]*?<!-- END DSH USER ENTERPRISE UI INJECTION -->/g, '');
  }

  const username = process.env.DSH_USER_NAME || 'User';
  const role = process.env.DSH_USER_ROLE || 'user';
  const isAdmin = (role === 'admin' || username.toLowerCase() === 'admin');

  const markup = `
<!-- DSH USER ENTERPRISE UI INJECTION -->
<style>
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

  /* User Modal Overlay */
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
    max-width: 400px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
    overflow: hidden;
    animation: dshModalFadeIn 0.18s ease-out;
  }
  @keyframes dshModalFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
  .dsh-modal-header {
    padding: 18px 22px 14px;
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
  .dsh-modal-body { padding: 18px 22px; color: #e6edf3; }
  .dsh-profile-row {
    display: flex; align-items: center; gap: 14px; margin-bottom: 16px;
  }
  .dsh-modal-avatar {
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg, #1f6feb, #8957e5);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: bold; color: #fff;
  }
  .dsh-meta-box {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    margin-bottom: 14px;
    line-height: 1.5;
  }

  /* Change Password Box */
  .dsh-cp-box {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 16px;
    transition: all 0.2s ease;
  }
  .dsh-cp-toggle-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
    user-select: none;
  }
  .dsh-cp-toggle-header:hover {
    color: #58a6ff;
  }
  .dsh-input-group {
    margin-top: 9px;
  }
  .dsh-input-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #8b949e;
    margin-bottom: 4px;
  }
  .dsh-input {
    width: 100%;
    box-sizing: border-box;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 7px 10px;
    color: #f0f6fc;
    font-size: 12.5px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .dsh-input:focus {
    border-color: #58a6ff;
    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.15);
  }
  .dsh-btn-change-pwd {
    background: #238636;
    color: #ffffff;
    border-color: rgba(240, 246, 252, 0.1);
    width: 100%;
    margin-top: 12px;
  }
  .dsh-btn-change-pwd:hover {
    background: #2ea043;
  }

  .dsh-modal-actions {
    display: flex; flex-direction: column; gap: 8px;
  }
  .dsh-btn {
    padding: 8px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
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

  /* Read-Only Mode Banner */
  #dsh-ro-banner {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(210, 153, 34, 0.16);
    border: 1px solid rgba(210, 153, 34, 0.45);
    border-radius: 8px;
    padding: 8px 16px;
    margin: 8px auto;
    width: fit-content;
    max-width: 90%;
    color: #e3b341;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    user-select: none;
    z-index: 9999;
  }

  ${!isAdmin ? `
  [data-key="models"],
  [data-tab="models"],
  [aria-controls*="models" i] {
    display: none !important;
  }
  ` : ''}
</style>

<div id="dsh-enterprise-user-btn" onclick="openDshUserModal()">
  <div class="dsh-user-avatar">${username.charAt(0).toUpperCase()}</div>
  <span>${username}</span>
  <span class="dsh-role-badge ${isAdmin ? 'dsh-role-admin' : 'dsh-role-user'}">${isAdmin ? 'ADMIN' : 'USER'}</span>
</div>

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
          <div style="font-size: 15px; font-weight: 700;">${username}</div>
          <div style="font-size: 12px; color: #8b949e; margin-top: 2px;">
            Vai trò: <span class="dsh-role-badge ${isAdmin ? 'dsh-role-admin' : 'dsh-role-user'}">${isAdmin ? 'ADMINISTRATOR' : 'USER'}</span>
          </div>
        </div>
      </div>

      <div class="dsh-meta-box">
        <div style="color: #8b949e;">Môi trường Sandbox:</div>
        <div style="color: #56d364; font-weight: 600;">Hardware Isolated Container</div>
        <div style="color: #8b949e; margin-top: 4px;">Giới hạn: <strong style="color: #f0f6fc;">256 MB RAM / 0.5 CPU</strong></div>
      </div>

      <!-- CHANGE PASSWORD ACCORDION -->
      <div class="dsh-cp-box">
        <div class="dsh-cp-toggle-header" onclick="toggleDshChangePasswordForm()">
          <span style="display: flex; align-items: center; gap: 6px;">🔑 Đổi mật khẩu</span>
          <span id="dsh-cp-arrow" style="font-size: 11px; color: #8b949e;">▼ Mở form</span>
        </div>
        <form id="dsh-cp-form" onsubmit="handleDshChangePassword(event)" style="display: none; margin-top: 6px;">
          <div class="dsh-input-group">
            <label class="dsh-input-label">Mật khẩu hiện tại</label>
            <input type="password" id="dsh-cp-old" class="dsh-input" placeholder="Nhập mật khẩu cũ" required autocomplete="current-password" />
          </div>
          <div class="dsh-input-group">
            <label class="dsh-input-label">Mật khẩu mới (tối thiểu 6 ký tự)</label>
            <input type="password" id="dsh-cp-new" class="dsh-input" placeholder="Nhập mật khẩu mới" required autocomplete="new-password" />
          </div>
          <div class="dsh-input-group">
            <label class="dsh-input-label">Xác nhận mật khẩu mới</label>
            <input type="password" id="dsh-cp-confirm" class="dsh-input" placeholder="Nhập lại mật khẩu mới" required autocomplete="new-password" />
          </div>
          <div id="dsh-cp-msg" style="display: none; margin-top: 10px; font-size: 12px; padding: 7px 10px; border-radius: 6px; line-height: 1.4;"></div>
          <button type="submit" id="dsh-cp-btn" class="dsh-btn dsh-btn-change-pwd">
            💾 Cập nhật mật khẩu
          </button>
        </form>
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

  function toggleDshChangePasswordForm() {
    const form = document.getElementById('dsh-cp-form');
    const arrow = document.getElementById('dsh-cp-arrow');
    const msg = document.getElementById('dsh-cp-msg');
    if (!form) return;
    const isHidden = (form.style.display === 'none' || !form.style.display);
    form.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.textContent = isHidden ? '▲ Thu gọn' : '▼ Mở form';
    if (msg) msg.style.display = 'none';
  }

  async function handleDshChangePassword(e) {
    e.preventDefault();
    const oldPassword = document.getElementById('dsh-cp-old').value;
    const newPassword = document.getElementById('dsh-cp-new').value;
    const confirmPassword = document.getElementById('dsh-cp-confirm').value;
    const btn = document.getElementById('dsh-cp-btn');
    const msg = document.getElementById('dsh-cp-msg');

    msg.style.display = 'none';

    if (!oldPassword || !newPassword) {
      showCpMsg('Vui lòng điền đầy đủ thông tin.', true);
      return;
    }
    if (newPassword.length < 6) {
      showCpMsg('Mật khẩu mới phải có ít nhất 6 ký tự.', true);
      return;
    }
    if (newPassword !== confirmPassword) {
      showCpMsg('Mật khẩu xác nhận không trùng khớp.', true);
      return;
    }
    if (oldPassword === newPassword) {
      showCpMsg('Mật khẩu mới không được trùng mật khẩu cũ.', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    try {
      const token = localStorage.getItem('dsh_user_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ oldPassword, newPassword })
      });

      const data = await res.json();

      if (!res.ok) {
        showCpMsg(data.error || 'Đổi mật khẩu thất bại.', true);
        btn.disabled = false;
        btn.textContent = '💾 Cập nhật mật khẩu';
        return;
      }

      showCpMsg('✅ ' + (data.message || 'Đổi mật khẩu thành công!'), false);
      document.getElementById('dsh-cp-form').reset();
      btn.disabled = false;
      btn.textContent = '💾 Cập nhật mật khẩu';

      setTimeout(() => {
        toggleDshChangePasswordForm();
      }, 2500);

    } catch (err) {
      showCpMsg('Lỗi kết nối máy chủ: ' + err.message, true);
      btn.disabled = false;
      btn.textContent = '💾 Cập nhật mật khẩu';
    }
  }

  function showCpMsg(text, isErr) {
    const msg = document.getElementById('dsh-cp-msg');
    if (!msg) return;
    msg.textContent = text;
    msg.style.display = 'block';
    if (isErr) {
      msg.style.background = 'rgba(218, 54, 51, 0.15)';
      msg.style.color = '#f85149';
      msg.style.border = '1px solid rgba(218, 54, 51, 0.4)';
    } else {
      msg.style.background = 'rgba(35, 134, 54, 0.15)';
      msg.style.color = '#3fb950';
      msg.style.border = '1px solid rgba(35, 134, 54, 0.4)';
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

  ${isAdmin ? `
  // READ-ONLY GUARD FOR ADMIN VIEWING OTHER USER WORKSPACES
  (function initAdminReadOnlyMonitor() {
    let isRoMode = false;
    let cachedPlaceholder = null;

    function ensureRoBanner() {
      let banner = document.getElementById('dsh-ro-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'dsh-ro-banner';
        banner.innerHTML = '⚠️ <strong>Chế độ Read-Only:</strong> Bạn đang xem phiên làm việc của User khác (Vô hiệu hóa gửi tin nhắn)';
        document.body.appendChild(banner);
      }
      return banner;
    }

    function detectRoWorkspace() {
      // 1. Check document title
      if (document.title && document.title.includes('[View]')) return true;

      // 2. Check URL / Hash / Path
      const decodedUrl = decodeURIComponent(window.location.href);
      if (decodedUrl.includes('[View]')) return true;

      // 3. Check active items in sidebar / tree
      const activeCandidates = document.querySelectorAll(
        '[class*="active"], [class*="selected"], [aria-selected="true"], [data-active="true"], [role="treeitem"][aria-selected="true"]'
      );
      for (const el of activeCandidates) {
        if (el.textContent && el.textContent.includes('[View]')) return true;
      }

      // 4. Check headers / breadcrumbs
      const headers = document.querySelectorAll('header, [class*="header"], [class*="title"], [class*="breadcrumb"]');
      for (const el of headers) {
        if (el.children.length < 5 && el.textContent && el.textContent.includes('[View]')) {
          return true;
        }
      }

      return false;
    }

    function applyRoState(enable) {
      const banner = ensureRoBanner();
      const textareas = document.querySelectorAll('textarea');
      const sendButtons = document.querySelectorAll('button[aria-label*="send" i], button[aria-label*="submit" i], button[type="submit"]');

      if (enable) {
        banner.style.display = 'flex';

        // Position banner nicely above or near the composer
        const mainTextarea = textareas[0];
        if (mainTextarea) {
          const parent = mainTextarea.closest('form') || mainTextarea.parentElement;
          if (parent && banner.parentElement !== parent && parent.parentElement) {
            parent.parentElement.insertBefore(banner, parent);
          }
        }

        textareas.forEach(ta => {
          if (!cachedPlaceholder && ta.placeholder) {
            cachedPlaceholder = ta.placeholder;
          }
          ta.disabled = true;
          ta.setAttribute('readonly', 'true');
          ta.placeholder = 'Chế độ Read-Only: Bạn đang xem phiên làm việc của User khác';
          ta.style.opacity = '0.45';
          ta.style.cursor = 'not-allowed';
          ta.style.backgroundColor = '#161b22';
        });

        sendButtons.forEach(btn => {
          btn.style.display = 'none';
          btn.disabled = true;
          btn.style.pointerEvents = 'none';
        });
      } else {
        banner.style.display = 'none';

        textareas.forEach(ta => {
          ta.disabled = false;
          ta.removeAttribute('readonly');
          if (cachedPlaceholder) {
            ta.placeholder = cachedPlaceholder;
          }
          ta.style.opacity = '1';
          ta.style.cursor = 'auto';
          ta.style.backgroundColor = '';
        });

        sendButtons.forEach(btn => {
          btn.style.display = '';
          btn.disabled = false;
          btn.style.pointerEvents = 'auto';
        });
      }
    }

    // Intercept clicks on [View] items or switching workspaces
    document.addEventListener('click', function(e) {
      const target = e.target;
      if (!target) return;
      const closest = target.closest('div, a, button, li, span');
      if (closest && closest.textContent) {
        if (closest.textContent.includes('[View]')) {
          isRoMode = true;
          applyRoState(true);
          return;
        } else if (
          closest.textContent.includes('Workspace') ||
          closest.getAttribute('role') === 'treeitem' ||
          closest.getAttribute('role') === 'tab' ||
          closest.classList.contains('tab-btn')
        ) {
          setTimeout(() => {
            isRoMode = detectRoWorkspace();
            applyRoState(isRoMode);
          }, 150);
        }
      }
    }, true);

    // Prevent submitting via Enter in RO mode
    document.addEventListener('keydown', function(e) {
      if (isRoMode && (e.key === 'Enter' || e.keyCode === 13)) {
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    }, true);

    // Periodic check to keep UI in sync
    setInterval(() => {
      const active = detectRoWorkspace();
      if (active !== isRoMode) {
        isRoMode = active;
        applyRoState(isRoMode);
      } else if (isRoMode) {
        applyRoState(true);
      }
    }, 400);

    setTimeout(() => {
      isRoMode = detectRoWorkspace();
      if (isRoMode) applyRoState(true);
    }, 600);
  })();
  ` : ''}

  ${!isAdmin ? `
  (function monitorAndHideModelsTab() {
    function hideElements() {
      const items = document.querySelectorAll('button, div, [role="tab"], li');
      items.forEach(el => {
        if (el.children.length <= 2 && el.textContent.trim() === 'Models') {
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
<!-- END DSH USER ENTERPRISE UI INJECTION -->
`;

  html = html.replace('</body>', `${markup}\n</body>`);
  fs.writeFileSync(targetIndex, html, 'utf8');
  console.log(`[inject-ui] Successfully injected enterprise UI for user "${username}" (${role})`);
} catch (e) {
  console.error('[inject-ui] Error injecting UI:', e.message);
}

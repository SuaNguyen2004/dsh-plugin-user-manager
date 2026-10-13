/**
 * Native DSH UI Injection Module
 * Injects User Header Bar and Admin Management Panel directly into DSH Web UI.
 * Pure authenticated mode: All unauthenticated visitors are redirected to /login.
 */

export function getNativeInjectionMarkup() {
  return `
<!-- === DSH USER MANAGER NATIVE UI INJECTION === -->
<style>
  #dsh-um-bar {
    position: fixed;
    top: 12px;
    right: 60px;
    z-index: 99999;
    display: none;
    align-items: center;
    gap: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }

  .dsh-um-pill {
    background: rgba(22, 27, 34, 0.94);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 30px;
    padding: 6px 14px;
    color: #e6edf3;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .dsh-um-btn {
    border: none;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .dsh-um-btn-primary { background: #238636; color: #fff; }
  .dsh-um-btn-primary:hover { background: #2ea043; }

  .dsh-um-btn-secondary { background: #30363d; color: #c9d1d9; border: 1px solid rgba(255, 255, 255, 0.1); }
  .dsh-um-btn-secondary:hover { background: #3c444d; color: #fff; }

  .dsh-um-btn-admin {
    background: linear-gradient(135deg, #8957e5, #da3633);
    color: #fff;
    font-weight: 700;
    box-shadow: 0 0 10px rgba(137, 87, 229, 0.4);
  }
  .dsh-um-btn-admin:hover { filter: brightness(1.15); transform: translateY(-1px); }

  .dsh-um-btn-danger { background: rgba(248, 81, 73, 0.2); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.3); }
  .dsh-um-btn-danger:hover { background: #f85149; color: #fff; }

  /* Modal Overlay */
  .dsh-um-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    z-index: 100000;
    display: none;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .dsh-um-modal {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    width: 90%;
    max-width: 520px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    color: #e6edf3;
    display: flex;
    flex-direction: column;
    animation: dshUmFadeIn 0.25s ease-out;
  }

  .dsh-um-modal-lg {
    max-width: 860px;
    max-height: 85vh;
  }

  @keyframes dshUmFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }

  .dsh-um-modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0d1117;
  }

  .dsh-um-modal-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .dsh-um-modal-body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }

  /* Tabs */
  .dsh-um-tabs { display: flex; gap: 8px; border-bottom: 1px solid #30363d; padding-bottom: 8px; margin-bottom: 8px; }
  .dsh-um-tab {
    background: transparent;
    border: none;
    color: #8b949e;
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  .dsh-um-tab.active { background: #21262d; color: #58a6ff; }

  /* Table */
  .dsh-um-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .dsh-um-table th, .dsh-um-table td { padding: 10px; text-align: left; border-bottom: 1px solid #30363d; }
  .dsh-um-table th { background: #0d1117; color: #8b949e; font-weight: 600; }

  .dsh-um-badge { padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .dsh-um-badge-pending { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid rgba(210, 153, 34, 0.4); }
  .dsh-um-badge-active { background: rgba(63, 185, 80, 0.2); color: #3fb950; border: 1px solid rgba(63, 185, 80, 0.4); }
  .dsh-um-badge-admin { background: rgba(188, 140, 255, 0.2); color: #bc8cff; border: 1px solid rgba(188, 140, 255, 0.4); }
  .dsh-um-badge-user { background: rgba(88, 166, 255, 0.2); color: #58a6ff; border: 1px solid rgba(88, 166, 255, 0.4); }

  /* Toast */
  #dsh-um-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #161b22;
    border: 1px solid #30363d;
    padding: 12px 18px;
    border-radius: 8px;
    color: #e6edf3;
    font-size: 13px;
    z-index: 100001;
    display: none;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }

  /* Prevent anyone from clicking Add workspace button in sidebar */
  button[aria-label*="Add workspace" i],
  button[aria-label*="add workspace" i],
  button[aria-label*="workspace.add" i],
  [data-row-key="workspace.add"] {
    display: none !important;
  }

  /* Permanently hide Ungrouped row */
  [data-row-key="workspace:ungrouped"],
  [data-row-key="workspace:"],
  [data-row-key="empty"] {
    display: none !important;
  }

  /* Model & Provider restrictions for regular users (Shared System Models mode) */
  body.dsh-um-role-user [class*="addModelButton"],
  body.dsh-um-role-user [class*="addModel"],
  body.dsh-um-role-user [class*="addBlock"],
  body.dsh-um-role-user [class*="addActions"],
  body.dsh-um-role-user [class*="editorHeader"],
  body.dsh-um-role-user [class*="zGbnIq_editor"],
  body.dsh-um-role-user [class*="iconButtonDanger"],
  body.dsh-um-role-user [class*="dangerButton"],
  body.dsh-um-role-user button[aria-label*="Add model" i],
  body.dsh-um-role-user button[aria-label*="Add provider" i],
  body.dsh-um-role-user button[aria-label*="Delete" i] {
    display: none !important;
  }
</style>

<!-- Top Right Floating Navigation for Authenticated User (hidden until session verified) -->
<div id="dsh-um-bar">
  <div id="dsh-um-user-view" class="dsh-um-pill">
    <span id="dsh-um-user-role-badge" class="dsh-um-badge dsh-um-badge-user">USER</span>
    <strong id="dsh-um-username-label">User</strong>
    <!-- Admin Button -->
    <button id="dsh-um-admin-btn" class="dsh-um-btn dsh-um-btn-admin" style="display: none;" onclick="dshUmOpenAdmin()">👑 Quản lý tài khoản</button>
    <button class="dsh-um-btn dsh-um-btn-danger" onclick="dshUmLogout()">Đăng xuất</button>
  </div>
</div>

<!-- Modal: Admin Account Management Panel -->
<div id="dsh-um-admin-modal" class="dsh-um-modal-overlay">
  <div class="dsh-um-modal dsh-um-modal-lg">
    <div class="dsh-um-modal-header">
      <div class="dsh-um-modal-title">👑 Bảng Quản Trị Người Dùng & Phê Duyệt Tài Khoản</div>
      <button class="dsh-um-btn dsh-um-btn-primary" onclick="dshUmCloseAdmin()">⬅️ Quay lại DSH</button>
    </div>
    <div class="dsh-um-modal-body">
      <div class="dsh-um-tabs">
        <button id="dsh-um-tab-pending" class="dsh-um-tab active" onclick="dshUmSwitchAdminTab('pending')">⏳ Chờ duyệt (<span id="dsh-um-pending-count">0</span>)</button>
        <button id="dsh-um-tab-all" class="dsh-um-tab" onclick="dshUmSwitchAdminTab('all')">👥 Tất cả thành viên</button>
        <button id="dsh-um-tab-models" class="dsh-um-tab" onclick="dshUmSwitchAdminTab('models')">🤖 Cấu hình Model & API Key</button>
      </div>

      <!-- Tab Pending -->
      <div id="dsh-um-admin-pending-view">
        <div style="margin-bottom: 10px; color: #8b949e; font-size: 12px;">Các tài khoản mới đăng ký cần Admin phê duyệt trước khi được phép đăng nhập vào DSH.</div>
        <table class="dsh-um-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tài khoản</th>
              <th>Thời gian đăng ký</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody id="dsh-um-pending-tbody">
            <tr><td colspan="5" style="text-align: center; color: #8b949e;">Đang tải danh sách chờ duyệt...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab All Users -->
      <div id="dsh-um-admin-all-view" style="display: none;">
        <table class="dsh-um-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Ngày tham gia</th>
            </tr>
          </thead>
          <tbody id="dsh-um-all-tbody">
            <tr><td colspan="5" style="text-align: center; color: #8b949e;">Đang tải danh sách thành viên...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Tab Models & API Keys (Admin only) -->
      <div id="dsh-um-admin-models-view" style="display: none;">
        <div style="margin-bottom: 12px; color: #8b949e; font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span>Quản lý nhà cung cấp (Providers), API Key và danh sách Model dùng chung cho toàn bộ người dùng trong hệ thống.</span>
          <button class="dsh-um-btn dsh-um-btn-secondary" onclick="dshUmLoadModelsConfig()" style="font-size: 11px;">🔄 Làm mới</button>
        </div>
        <div id="dsh-um-models-container" style="display: flex; flex-direction: column; gap: 14px;">
          <div style="text-align: center; color: #8b949e; padding: 20px;">Đang tải cấu hình Model & API Key...</div>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="dsh-um-toast"></div>

<!-- JavaScript Integration Logic -->
<script>
  (function() {
    let currentAdminTab = 'pending';
    let currentUserSession = null;

    function updateIsolationStyle(username) {
      if (!username) return;
      const u = username.toLowerCase();
      let styleEl = document.getElementById('dsh-um-isolation-dynamic-css');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'dsh-um-isolation-dynamic-css';
        document.head.appendChild(styleEl);
      }
      const newCss = 
        '[class*="groupSection"]:not(:has([data-row-key="workspace:user-workspace-' + u + '"])) { display: none !important; } ' +
        '[data-row-key^="workspace:"]:not([data-row-key="workspace:user-workspace-' + u + '"]) { display: none !important; }';
      if (styleEl.textContent !== newCss) {
        styleEl.textContent = newCss;
      }
    }

    try {
      const savedUser = localStorage.getItem('dsh_user_info');
      if (savedUser) {
        currentUserSession = JSON.parse(savedUser);
        if (currentUserSession && currentUserSession.username) {
          updateIsolationStyle(currentUserSession.username);
        }
      }
    } catch (e) {}

    function toast(msg, isError = false) {
      const t = document.getElementById('dsh-um-toast');
      if (!t) return;
      t.textContent = msg;
      t.style.borderLeftColor = isError ? '#f85149' : '#3fb950';
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 4000);
    }

    // Check Current Auth Session via server API
    async function checkSession() {
      try {
        const token = localStorage.getItem('dsh_user_token');
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: headers
        });

        if (res.ok) {
          const data = await res.json();
          currentUserSession = data.user;
          localStorage.setItem('dsh_user_info', JSON.stringify(data.user));
          if (data.token) {
            localStorage.setItem('dsh_user_token', data.token);
          }
          const username = data.user.username;
          const userKey = 'dsh.sessions.current.' + username;
          const lastUser = localStorage.getItem('dsh_last_username');

          if (lastUser && lastUser !== username) {
            // Đổi tài khoản: khôi phục session thuộc tài khoản này nếu có
            const savedSession = localStorage.getItem(userKey);
            if (savedSession) {
              localStorage.setItem('dsh.sessions.current', savedSession);
            }
            window._dshAutoSelectedWsDone = false;
          }

          // Đảm bảo dsh.sessions.current luôn trỏ tới session hợp lệ của user
          const curSaved = localStorage.getItem('dsh.sessions.current');
          let hasSession = false;
          if (curSaved) {
            try {
              const p = JSON.parse(curSaved);
              if (p && p.sessionId) hasSession = true;
            } catch (e) {}
          }
          if (!hasSession) {
            const userSaved = localStorage.getItem(userKey);
            if (userSaved) {
              localStorage.setItem('dsh.sessions.current', userSaved);
            } else {
              fetch('/api/workspace/user-init', {
                method: 'POST',
                credentials: 'include',
                headers: getAdminHeaders()
              }).then(r => r.json()).then(initData => {
                if (initData && initData.sessionId) {
                  const payload = JSON.stringify({ sessionId: initData.sessionId });
                  localStorage.setItem('dsh.sessions.current', payload);
                  localStorage.setItem(userKey, payload);
                }
              }).catch(() => {});
            }
          } else {
            localStorage.setItem(userKey, curSaved);
          }

          localStorage.setItem('dsh_last_username', username);
          if (data.user && data.user.username) {
            updateIsolationStyle(data.user.username);
          }
          renderSessionUI();
        } else {
          currentUserSession = null;
          localStorage.removeItem('dsh_user_token');
          localStorage.removeItem('dsh_user_info');
          window.location.href = '/login';
        }
      } catch (e) {
        if (!currentUserSession) {
          window.location.href = '/login';
        }
      }
    }

    function renderSessionUI() {
      if (!currentUserSession) return;

      const bar = document.getElementById('dsh-um-bar');
      const userLabel = document.getElementById('dsh-um-username-label');
      const roleBadge = document.getElementById('dsh-um-user-role-badge');
      const adminBtn = document.getElementById('dsh-um-admin-btn');

      if (userLabel) userLabel.textContent = currentUserSession.username;
      if (roleBadge) {
        roleBadge.textContent = currentUserSession.role.toUpperCase();
        roleBadge.className = 'dsh-um-badge dsh-um-badge-' + currentUserSession.role;
      }

      if (adminBtn) {
        adminBtn.style.display = currentUserSession.role === 'admin' ? 'inline-flex' : 'none';
      }

      if (currentUserSession.role === 'admin') {
        document.body.classList.add('dsh-um-role-admin');
        document.body.classList.remove('dsh-um-role-user');
      } else {
        document.body.classList.add('dsh-um-role-user');
        document.body.classList.remove('dsh-um-role-admin');
      }

      if (bar) bar.style.display = 'flex';
      applyWorkspaceIsolation();
    }

    // Strict Workspace Isolation
    function applyWorkspaceIsolation() {
      // Auto-dismiss any directory picker error dialog that may appear
      const errorModals = document.querySelectorAll('[role="dialog"], [class*="modal"]');
      errorModals.forEach(m => {
        const txt = (m.textContent || '').toLowerCase();
        if (txt.includes('couldn') || txt.includes('directory picker') || txt.includes('directorypickercontroller')) {
          const cancelBtn = Array.from(m.querySelectorAll('button')).find(b => (b.textContent || '').toLowerCase().includes('cancel'));
          if (cancelBtn) {
            cancelBtn.click();
          } else {
            m.style.setProperty('display', 'none', 'important');
          }
        }
      });

      // If session is not confirmed yet, do not show any workspace items to prevent leakage
      if (!currentUserSession || !currentUserSession.username) {
        document.querySelectorAll('[class*="groupSection"], [data-row-key^="workspace:"]').forEach(el => {
          el.style.setProperty('display', 'none', 'important');
        });
        return;
      }

      const u = currentUserSession.username.toLowerCase();
      updateIsolationStyle(u);

      // 1. Isolate Sidebar groups by groupSection: ONLY show this user's workspace group
      const groupSections = document.querySelectorAll('[class*="groupSection"]');
      groupSections.forEach(gs => {
        const text = (gs.textContent || '').toLowerCase();
        const wsRow = gs.querySelector('[data-row-key^="workspace:"]') || gs;
        const key = (wsRow.getAttribute('data-row-key') || '').toLowerCase();

        // Strictly block default-workspace, guest, test, or unassigned workspaces
        if (text.includes('test_deepseek_harness') || key.includes('test_deepseek_harness') ||
            text.includes('default-workspace') || key.includes('default-workspace') ||
            text.includes('test_usr') || key.includes('test_usr') ||
            text.includes('khách') || key.includes('guest') || text.includes('ungrouped') || key.includes('ungrouped')) {
          gs.style.setProperty('display', 'none', 'important');
          return;
        }

        // Check if matches user's workspace: e.g. "Workspace (nvs)" or "user-workspace-nvs"
        const isMyWorkspace = text.includes('(' + u + ')') || key.includes('user-workspace-' + u);

        if (isMyWorkspace) {
          gs.style.removeProperty('display');

          // Mở rộng folder nếu có nút chevron/expand riêng biệt
          const expandBtn = wsRow.querySelector('button[aria-label*="expand" i], [aria-label*="collapse" i]');
          if (expandBtn && wsRow.getAttribute('aria-expanded') === 'false' && !window._dshWsExpandedOnce) {
            window._dshWsExpandedOnce = true;
            setTimeout(() => {
              try { expandBtn.click(); } catch (e) {}
            }, 300);
          }
        } else {
          gs.style.setProperty('display', 'none', 'important');
        }
      });

      // 1b. Hide any stray workspace rows outside groupSection
      document.querySelectorAll('[data-row-key^="workspace:"]').forEach(row => {
        const key = (row.getAttribute('data-row-key') || '').toLowerCase();
        const text = (row.textContent || '').toLowerCase();
        if (!key.includes('user-workspace-' + u) && !text.includes('(' + u + ')')) {
          row.style.setProperty('display', 'none', 'important');
        }
      });

      // 2. Auto-select user's workspace on hero screen if no workspace is active yet
      const heroWsBtn = document.querySelector('button.pXSMma_workspace, [data-conversation-region="hero"] button, [class*="heroWorkspaceRow"] button, [data-slot="conversation.hero.workspace"] button');
      if (heroWsBtn && !heroWsBtn.closest('[data-conversation-region="composer"]')) {
        const btnText = (heroWsBtn.textContent || '').toLowerCase();
        if (!btnText.includes('(' + u + ')') && (btnText.includes('choose') || btnText.includes('chọn') || btnText.includes('workspace')) && !window._dshAutoSelectedWsDone) {
          if (!window._dshAutoSelectingWs) {
            window._dshAutoSelectingWs = true;
            if (heroWsBtn.getAttribute('aria-expanded') !== 'true') {
              heroWsBtn.click();
            }
            const checkInterval = setInterval(() => {
              const items = document.querySelectorAll('[role="menuitem"]');
              for (const item of items) {
                const itemText = (item.textContent || '').toLowerCase();
                if (itemText.includes('(' + u + ')') || itemText.includes(u)) {
                  window._dshAutoSelectedWsDone = true;
                  clearInterval(checkInterval);
                  item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
                  item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  item.click();
                  return;
                }
              }
            }, 80);
            setTimeout(() => {
              clearInterval(checkInterval);
              window._dshAutoSelectingWs = false;
            }, 2000);
          }
        } else if (btnText.includes('(' + u + ')')) {
          window._dshAutoSelectedWsDone = true;
        }
      }

      if (!window._dshNewSessionBound) {
        window._dshNewSessionBound = true;
        document.addEventListener('click', (ev) => {
          const btn = ev.target.closest('[class*="newSession"]');
          if (btn) {
            window._dshAutoSelectedWsDone = false;
          }
        }, true);
      }

      // 3. Filter open menu items: ONLY filter workspace picker items (preserve model selection, commands, settings, permissions)
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      menuItems.forEach(item => {
        // Never filter model selection menu, settings, commands, or permissions
        if (item.closest('[aria-label*="model" i], [class*="model" i], [class*="groups_"]')) {
          item.style.removeProperty('display');
          return;
        }

        const text = (item.textContent || '').trim().toLowerCase();

        // STRICT EXEMPTION: Never filter permission presets (Workspace Write, Read Only, Full access, Auto review)
        const isPermissionPreset =
          text === 'workspace write' ||
          text.includes('workspace write') ||
          text.includes('workspace-write') ||
          text.includes('read only') ||
          text.includes('full access') ||
          text.includes('auto review') ||
          text.includes('工作区内修改') ||
          text.includes('仅可查看') ||
          text.includes('完全权限');

        if (isPermissionPreset) {
          item.style.removeProperty('display');
          return;
        }

        // STRICT IDENTIFICATION: Only target actual workspace picker items
        const isWorkspaceEntry =
          text.includes('add workspace') ||
          text.includes('add workspace…') ||
          text.includes('ungrouped') ||
          text.includes('guest') ||
          text.includes('khách') ||
          text.includes('workspace (') ||
          text.startsWith('workspace (') ||
          text.includes('user-workspace-');

        if (!isWorkspaceEntry) {
          // It's a model, permission, command, or action — leave it untouched!
          item.style.removeProperty('display');
          return;
        }

        if (text.includes('add workspace') || text.includes('ungrouped') || text.includes('guest') || text.includes('khách')) {
          item.style.setProperty('display', 'none', 'important');
          return;
        }

        const isMyWs = text.includes('(' + u + ')') || text.includes('user-workspace-' + u) || text === u;
        if (isMyWs) {
          item.style.removeProperty('display');
        } else {
          item.style.setProperty('display', 'none', 'important');
        }
      });
    }

    // Logout
    window.dshUmLogout = async function() {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {}

      // Lưu lại session hiện tại của người dùng trước khi thoát
      if (currentUserSession && currentUserSession.username) {
        const cur = localStorage.getItem('dsh.sessions.current');
        if (cur) {
          localStorage.setItem('dsh.sessions.current.' + currentUserSession.username, cur);
        }
      }

      localStorage.removeItem('dsh_user_token');
      localStorage.removeItem('dsh_user_info');
      localStorage.removeItem('dsh.sessions.current');
      sessionStorage.clear();
      document.cookie = 'dsh_user_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';

      toast('Đã đăng xuất! Đang chuyển về trang đăng nhập...');
      setTimeout(() => {
        window.location.href = '/login?logout=1';
      }, 300);
    };

    // Theo dõi session selection thay đổi để lưu per-user
    setInterval(() => {
      if (currentUserSession && currentUserSession.username) {
        const cur = localStorage.getItem('dsh.sessions.current');
        if (cur) {
          try {
            const p = JSON.parse(cur);
            if (p && p.sessionId) {
              localStorage.setItem('dsh.sessions.current.' + currentUserSession.username, cur);
            }
          } catch (e) {}
        }
      }
    }, 2000);

    // Admin Panel Actions
    window.dshUmOpenAdmin = function() {
      document.getElementById('dsh-um-admin-modal').style.display = 'flex';
      dshUmLoadPendingUsers();
    };

    window.dshUmCloseAdmin = function() {
      document.getElementById('dsh-um-admin-modal').style.display = 'none';
    };

    window.dshUmSwitchAdminTab = function(tab) {
      currentAdminTab = tab;
      const tabPending = document.getElementById('dsh-um-tab-pending');
      const tabAll = document.getElementById('dsh-um-tab-all');
      const tabModels = document.getElementById('dsh-um-tab-models');
      const viewPending = document.getElementById('dsh-um-admin-pending-view');
      const viewAll = document.getElementById('dsh-um-admin-all-view');
      const viewModels = document.getElementById('dsh-um-admin-models-view');

      if (tabPending) tabPending.classList.toggle('active', tab === 'pending');
      if (tabAll) tabAll.classList.toggle('active', tab === 'all');
      if (tabModels) tabModels.classList.toggle('active', tab === 'models');

      if (viewPending) viewPending.style.display = tab === 'pending' ? 'block' : 'none';
      if (viewAll) viewAll.style.display = tab === 'all' ? 'block' : 'none';
      if (viewModels) viewModels.style.display = tab === 'models' ? 'block' : 'none';

      if (tab === 'pending') {
        dshUmLoadPendingUsers();
      } else if (tab === 'all') {
        dshUmLoadAllUsers();
      } else if (tab === 'models') {
        dshUmLoadModelsConfig();
      }
    };

    function getAdminHeaders() {
      const token = localStorage.getItem('dsh_user_token');
      return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }

    async function dshUmLoadPendingUsers() {
      const tbody = document.getElementById('dsh-um-pending-tbody');
      try {
        const res = await fetch('/api/admin/pending-users', { credentials: 'include', headers: getAdminHeaders() });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error(text || 'Phản hồi không hợp lệ từ máy chủ'); }
        if (!res.ok) throw new Error(data.error || 'Lỗi HTTP ' + res.status);

        document.getElementById('dsh-um-pending-count').textContent = data.pending_users.length;
        tbody.innerHTML = '';

        if (data.pending_users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #3fb950; padding: 20px;">✅ Không có người dùng nào đang chờ duyệt!</td></tr>';
          return;
        }

        data.pending_users.forEach(u => {
          const tr = document.createElement('tr');
          const tdId = document.createElement('td');
          tdId.textContent = '#' + u.id;
          const tdUser = document.createElement('td');
          tdUser.innerHTML = '<strong>' + u.username + '</strong>';
          const tdTime = document.createElement('td');
          tdTime.textContent = u.created_at || '';
          const tdBadge = document.createElement('td');
          tdBadge.innerHTML = '<span class="dsh-um-badge dsh-um-badge-pending">Chờ duyệt</span>';
          const tdActions = document.createElement('td');

          const btnApprove = document.createElement('button');
          btnApprove.className = 'dsh-um-btn dsh-um-btn-primary';
          btnApprove.style.padding = '4px 10px';
          btnApprove.textContent = '✅ Duyệt nhanh';
          btnApprove.onclick = () => dshUmApprove(u.username);

          const btnReject = document.createElement('button');
          btnReject.className = 'dsh-um-btn dsh-um-btn-danger';
          btnReject.style.padding = '4px 10px';
          btnReject.style.marginLeft = '6px';
          btnReject.textContent = '❌ Từ chối';
          btnReject.onclick = () => dshUmReject(u.username);

          tdActions.appendChild(btnApprove);
          tdActions.appendChild(btnReject);

          tr.appendChild(tdId);
          tr.appendChild(tdUser);
          tr.appendChild(tdTime);
          tr.appendChild(tdBadge);
          tr.appendChild(tdActions);
          tbody.appendChild(tr);
        });
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: #f85149; text-align: center;">Lỗi tải dữ liệu: ' + err.message + '</td></tr>';
      }
    }

    async function dshUmLoadAllUsers() {
      const tbody = document.getElementById('dsh-um-all-tbody');
      try {
        const res = await fetch('/api/admin/users', { credentials: 'include', headers: getAdminHeaders() });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error(text || 'Phản hồi không hợp lệ từ máy chủ'); }
        if (!res.ok) throw new Error(data.error || 'Lỗi HTTP ' + res.status);

        tbody.innerHTML = '';
        data.users.forEach(u => {
          const tr = document.createElement('tr');
          tr.innerHTML = '<td>#' + u.id + '</td>' +
            '<td><strong>' + u.username + '</strong></td>' +
            '<td><span class="dsh-um-badge dsh-um-badge-' + u.role + '">' + u.role + '</span></td>' +
            '<td><span class="dsh-um-badge dsh-um-badge-' + u.status + '">' + u.status + '</span></td>' +
            '<td>' + (u.created_at || 'Mặc định') + '</td>';
          tbody.appendChild(tr);
        });
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="color: #f85149; text-align: center;">Lỗi tải danh sách: ' + err.message + '</td></tr>';
      }
    }

    window.dshUmApprove = async function(username) {
      try {
        const res = await fetch('/api/admin/approve-user', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Đã duyệt tài khoản ' + username + ' thành công!');
        dshUmLoadPendingUsers();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    };

    window.dshUmReject = async function(username) {
      if (!confirm('Bạn có chắc muốn từ chối tài khoản "' + username + '"?')) return;
      try {
        const res = await fetch('/api/admin/reject-user', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast('Đã từ chối tài khoản ' + username);
        dshUmLoadPendingUsers();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    };

    async function dshUmLoadModelsConfig() {
      const container = document.getElementById('dsh-um-models-container');
      if (!container) return;
      container.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">Đang tải cấu hình Model & API Key...</div>';

      try {
        const res = await fetch('/api/admin/models/config', { credentials: 'include', headers: getAdminHeaders() });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error(text || 'Phản hồi không hợp lệ từ máy chủ'); }
        if (!res.ok) throw new Error(data.error || 'Lỗi HTTP ' + res.status);

        if (!data.providers || data.providers.length === 0) {
          container.innerHTML = '<div style="text-align: center; color: #8b949e; padding: 20px;">Không tìm thấy cấu hình Provider nào trong hệ thống.</div>';
          return;
        }

        container.innerHTML = '';
        data.providers.forEach(p => {
          const card = document.createElement('div');
          card.style.cssText = 'background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 10px;';

          const header = document.createElement('div');
          header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

          const title = document.createElement('div');
          title.innerHTML = '<strong>' + p.displayName + '</strong> <span style="color: #8b949e; font-size: 11px; margin-left: 6px;">(' + p.apiKeyEnv + ')</span>';

          const summary = p.poolSummary || { total: 0, active: 0, cooldown: 0, keys: [] };
          const statusBadge = document.createElement('span');
          if (summary.total > 1) {
            statusBadge.className = 'dsh-um-badge dsh-um-badge-active';
            statusBadge.textContent = '🔄 Key Pool: ' + summary.active + '/' + summary.total + ' Active';
          } else if (summary.total === 1) {
            statusBadge.className = 'dsh-um-badge ' + (summary.active > 0 ? 'dsh-um-badge-active' : 'dsh-um-badge-pending');
            statusBadge.textContent = summary.active > 0 ? ('1 Key (' + (summary.keys[0]?.masked || 'Đã cài') + ')') : 'Key đang cooldown';
          } else {
            statusBadge.className = 'dsh-um-badge dsh-um-badge-pending';
            statusBadge.textContent = 'Chưa có Key';
          }

          header.appendChild(title);
          header.appendChild(statusBadge);
          card.appendChild(header);

          // Models list
          if (p.models && p.models.length > 0) {
            const modelsDiv = document.createElement('div');
            modelsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';
            modelsDiv.innerHTML = '<span style="font-size: 11px; color: #8b949e;">Models:</span> ' +
              p.models.map(m => '<span style="background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-family: monospace; color: #58a6ff;">' + (m.name || m.id) + '</span>').join('');
            card.appendChild(modelsDiv);
          }

          // Active Key Pool Display (if keys exist)
          if (summary.keys && summary.keys.length > 0) {
            const poolDiv = document.createElement('div');
            poolDiv.style.cssText = 'background: #161b22; border: 1px solid #21262d; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;';
            
            const poolHeader = document.createElement('div');
            poolHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #8b949e;';
            poolHeader.innerHTML = '<span>⚡ <strong>Danh sách Key trong Pool:</strong> (Tự động xoay khi dính 429)</span>';
            
            if (summary.cooldown > 0) {
              const btnResetCd = document.createElement('button');
              btnResetCd.style.cssText = 'background: transparent; border: 1px solid #388bfd; color: #58a6ff; font-size: 10px; border-radius: 4px; padding: 2px 6px; cursor: pointer;';
              btnResetCd.textContent = '🔄 Đặt lại Cooldown';
              btnResetCd.onclick = async () => {
                await dshUmResetCooldown(p.apiKeyEnv);
              };
              poolHeader.appendChild(btnResetCd);
            }
            poolDiv.appendChild(poolHeader);

            const keysRow = document.createElement('div');
            keysRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';
            summary.keys.forEach(k => {
              const keyPill = document.createElement('span');
              const isCooling = k.status === 'cooldown';
              keyPill.style.cssText = 'padding: 3px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; display: inline-flex; align-items: center; gap: 4px; ' +
                (isCooling ? 'background: #382402; border: 1px solid #9e6a03; color: #d29922;' : 'background: #0d281e; border: 1px solid #1a7f37; color: #3fb950;');
              keyPill.innerHTML = (isCooling ? '⏳ ' : '🟢 ') + k.masked + (isCooling ? ' (' + k.cooldownRemainingSec + 's)' : '');
              keysRow.appendChild(keyPill);
            });
            poolDiv.appendChild(keysRow);
            card.appendChild(poolDiv);
          }

          // Input row for multiple keys
          const actionRow = document.createElement('div');
          actionRow.style.cssText = 'display: flex; gap: 8px; align-items: flex-start; margin-top: 4px;';

          const input = document.createElement('textarea');
          input.rows = 2;
          input.placeholder = summary.total > 0
            ? 'Dán thêm hoặc thay thế API key (mỗi key 1 dòng từ tài khoản khác nhau)...'
            : 'Nhập API key (mỗi key 1 dòng từ các tài khoản khác nhau để xoay vòng tránh 429)...';
          input.style.cssText = 'flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; color: #e6edf3; font-size: 11px; font-family: monospace; resize: vertical; min-height: 38px;';

          const btnCol = document.createElement('div');
          btnCol.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

          const btnSave = document.createElement('button');
          btnSave.className = 'dsh-um-btn dsh-um-btn-primary';
          btnSave.textContent = '💾 Lưu Key';
          btnSave.style.cssText = 'white-space: nowrap; font-size: 12px; padding: 6px 12px;';
          btnSave.onclick = async () => {
            const val = input.value.trim();
            if (!val) {
              toast('Vui lòng nhập ít nhất 1 API Key!', true);
              return;
            }
            await dshUmSaveApiKey(p.apiKeyEnv, val);
          };
          btnCol.appendChild(btnSave);

          if (summary.total > 0) {
            const btnDelete = document.createElement('button');
            btnDelete.className = 'dsh-um-btn dsh-um-btn-danger';
            btnDelete.textContent = '🗑️ Xóa hết';
            btnDelete.style.cssText = 'white-space: nowrap; font-size: 11px; padding: 4px 8px;';
            btnDelete.onclick = async () => {
              if (!confirm('Bạn có chắc muốn xóa toàn bộ key của "' + p.displayName + '"?')) return;
              await dshUmDeleteApiKey(p.apiKeyEnv);
            };
            btnCol.appendChild(btnDelete);
          }

          actionRow.appendChild(input);
          actionRow.appendChild(btnCol);

          card.appendChild(actionRow);
          container.appendChild(card);
        });
      } catch (err) {
        container.innerHTML = '<div style="color: #f85149; text-align: center; padding: 20px;">Lỗi tải cấu hình Model: ' + err.message + '</div>';
      }
    }

    async function dshUmSaveApiKey(ref, value) {
      try {
        const res = await fetch('/api/admin/models/key', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ ref, value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message || 'Cập nhật API Key thành công!');
        dshUmLoadModelsConfig();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    }

    async function dshUmDeleteApiKey(ref) {
      try {
        const res = await fetch('/api/admin/models/delete-key', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ ref })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message || 'Đã gỡ API Key thành công!');
        dshUmLoadModelsConfig();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    }

    async function dshUmResetCooldown(ref) {
      try {
        const res = await fetch('/api/admin/models/reset-cooldown', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ ref })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message || 'Đã đặt lại trạng thái cooldown!');
        dshUmLoadModelsConfig();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    }

    window.dshUmLoadModelsConfig = dshUmLoadModelsConfig;
    window.dshUmSaveApiKey = dshUmSaveApiKey;
    window.dshUmDeleteApiKey = dshUmDeleteApiKey;
    window.dshUmResetCooldown = dshUmResetCooldown;

    // Auto check session when DSH page loads
    if (currentUserSession) {
      renderSessionUI();
    }
    checkSession();
    applyWorkspaceIsolation();

    window.addEventListener('DOMContentLoaded', () => {
      checkSession();
      applyWorkspaceIsolation();
    });
    setTimeout(() => {
      checkSession();
      applyWorkspaceIsolation();
    }, 500);
    setTimeout(() => {
      applyWorkspaceIsolation();
    }, 1500);

    function injectSettingsModelsBridge() {
      if (!currentUserSession || currentUserSession.role !== 'admin') return;
      if (document.getElementById('dsh-um-settings-bridge-banner')) return;

      const dialogs = document.querySelectorAll('[role="dialog"], [class*="settings" i], [class*="modal" i]');
      for (const diag of dialogs) {
        if (diag.id === 'dsh-um-admin-modal') continue;
        const addProviderBtn = Array.from(diag.querySelectorAll('button')).find(b => (b.textContent || '').includes('Add model provider'));
        if (addProviderBtn) {
          const contentArea = addProviderBtn.parentElement;
          if (contentArea && !document.getElementById('dsh-um-settings-bridge-banner')) {
            const banner = document.createElement('div');
            banner.id = 'dsh-um-settings-bridge-banner';
            banner.style.cssText = 'background: linear-gradient(135deg, #1f1f38, #2a1f4e); border: 1px solid #7c3aed; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #f3e8ff; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            banner.innerHTML = '<div style="font-size: 13px; line-height: 1.4;">' +
                '<div style="font-weight: 600; color: #e9d5ff; margin-bottom: 3px;">🔄 Quản lý Key Pool (Nhiều API Key chống 429)</div>' +
                '<div style="color: #cbd5e1; font-size: 12px;">Mặc định DSH chỉ cho nhập 1 key đơn lẻ. Hãy dùng bảng quản trị để cấu hình nhiều key xoay vòng tự động khi bị giới hạn token/phút.</div>' +
              '</div>' +
              '<button type="button" style="background: #8b5cf6; color: white; border: none; border-radius: 6px; padding: 8px 14px; font-weight: 600; font-size: 12px; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 6px rgba(139,92,246,0.4);" onclick="dshUmOpenAdmin(); dshUmSwitchAdminTab(\'models\');">' +
                '👑 Mở Cấu hình Key Pool' +
              '</button>';
            contentArea.insertBefore(banner, contentArea.firstChild);
          }
          break;
        }
      }
    }

    // Dynamic MutationObserver to maintain isolation as React re-renders
    const observer = new MutationObserver(() => {
      applyWorkspaceIsolation();
      injectSettingsModelsBridge();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();
</script>
<!-- === END DSH USER MANAGER NATIVE UI INJECTION === -->
`;
}

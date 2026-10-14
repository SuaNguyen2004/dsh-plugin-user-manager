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
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: rgba(0, 0, 0, 0.75) !important;
    backdrop-filter: blur(8px) !important;
    z-index: 100000 !important;
    display: none;
    align-items: center !important;
    justify-content: center !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  }

  .dsh-um-modal {
    background: #161b22 !important;
    background-color: #161b22 !important;
    border: 1px solid #30363d !important;
    border-radius: 12px !important;
    width: 90% !important;
    max-width: 520px !important;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6) !important;
    overflow: hidden !important;
    color: #e6edf3 !important;
    display: flex !important;
    flex-direction: column !important;
    animation: dshUmFadeIn 0.25s ease-out !important;
  }

  .dsh-um-modal-lg {
    max-width: 860px !important;
    max-height: 85vh !important;
  }

  @keyframes dshUmFadeIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }

  .dsh-um-modal-header {
    padding: 16px 20px !important;
    border-bottom: 1px solid #30363d !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    background: #0d1117 !important;
    background-color: #0d1117 !important;
    color: #e6edf3 !important;
  }

  .dsh-um-modal-title { font-size: 16px !important; font-weight: 700 !important; display: flex !important; align-items: center !important; gap: 8px !important; color: #e6edf3 !important; }
  .dsh-um-modal-body { padding: 20px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 14px !important; background: #161b22 !important; background-color: #161b22 !important; color: #e6edf3 !important; }

  /* Tabs */
  .dsh-um-tabs { display: flex !important; gap: 8px !important; border-bottom: 1px solid #30363d !important; padding-bottom: 8px !important; margin-bottom: 8px !important; background: transparent !important; }
  .dsh-um-tab {
    background: transparent !important;
    border: none !important;
    color: #8b949e !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    padding: 6px 12px !important;
    border-radius: 6px !important;
    cursor: pointer !important;
  }
  .dsh-um-tab.active { background: #21262d !important; background-color: #21262d !important; color: #58a6ff !important; }

  /* Table */
  .dsh-um-table { width: 100% !important; border-collapse: collapse !important; font-size: 13px !important; background: transparent !important; }
  .dsh-um-table th, .dsh-um-table td { padding: 10px !important; text-align: left !important; border-bottom: 1px solid #30363d !important; color: #e6edf3 !important; background: transparent !important; }
  .dsh-um-table th { background: #0d1117 !important; background-color: #0d1117 !important; color: #8b949e !important; font-weight: 600 !important; }

  .dsh-um-badge { padding: 2px 8px !important; border-radius: 12px !important; font-size: 11px !important; font-weight: 600 !important; text-transform: uppercase !important; display: inline-flex !important; align-items: center !important; }
  .dsh-um-badge-pending { background: #382402 !important; background-color: #382402 !important; color: #d29922 !important; border: 1px solid #9e6a03 !important; }
  .dsh-um-badge-active { background: #0d281e !important; background-color: #0d281e !important; color: #3fb950 !important; border: 1px solid #1a7f37 !important; }
  .dsh-um-badge-admin { background: rgba(188, 140, 255, 0.2) !important; color: #bc8cff !important; border: 1px solid rgba(188, 140, 255, 0.4) !important; }
  .dsh-um-badge-user { background: rgba(88, 166, 255, 0.2) !important; color: #58a6ff !important; border: 1px solid rgba(88, 166, 255, 0.4) !important; }

  /* Tab 3: Model & API Key Isolation (Immune to light theme or skin injection) */
  #dsh-um-admin-models-view {
    background: transparent !important;
    color: #e6edf3 !important;
  }

  #dsh-um-admin-models-view .dsh-um-model-card,
  #dsh-um-admin-modal [data-dsh-dream-skin-composer-card] {
    background: #0d1117 !important;
    background-color: #0d1117 !important;
    border: 1px solid #30363d !important;
    border-radius: 8px !important;
    padding: 14px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
    color: #e6edf3 !important;
    position: relative !important;
    isolation: auto !important;
    outline: none !important;
    box-shadow: none !important;
  }

  #dsh-um-admin-modal [data-dsh-dream-skin-composer-card]::before,
  #dsh-um-admin-modal [data-dsh-dream-skin-composer-card]::after,
  #dsh-um-admin-models-view .dsh-um-model-card::before,
  #dsh-um-admin-models-view .dsh-um-model-card::after {
    display: none !important;
    content: none !important;
    opacity: 0 !important;
  }

  #dsh-um-admin-models-view textarea,
  #dsh-um-admin-models-view input {
    background: #161b22 !important;
    background-color: #161b22 !important;
    border: 1px solid #30363d !important;
    border-radius: 6px !important;
    color: #e6edf3 !important;
    font-size: 11px !important;
    font-family: monospace !important;
  }

  #dsh-um-admin-models-view textarea:focus,
  #dsh-um-admin-models-view input:focus {
    outline: none !important;
    border-color: #58a6ff !important;
  }

  #dsh-um-admin-models-view textarea::placeholder,
  #dsh-um-admin-models-view input::placeholder {
    color: #6e7681 !important;
  }

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
  <div class="dsh-um-modal dsh-um-modal-lg" role="dialog" aria-modal="true">
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
          card.className = 'dsh-um-model-card';
          card.setAttribute('data-dsh-dream-skin-composer-card', '0');
          card.style.cssText = 'background: #0d1117 !important; background-color: #0d1117 !important; border: 1px solid #30363d !important; border-radius: 8px !important; padding: 14px !important; display: flex !important; flex-direction: column !important; gap: 10px !important; color: #e6edf3 !important; position: relative !important; isolation: auto !important; box-shadow: none !important;';

          const header = document.createElement('div');
          header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

          const title = document.createElement('div');
          title.innerHTML = '<strong style="color: #ffffff !important; font-size: 13px;">' + p.displayName + '</strong> <span style="color: #8b949e !important; font-size: 11px; margin-left: 6px;">(' + p.apiKeyEnv + ')</span>';

          const summary = p.poolSummary || { total: 0, active: 0, cooldown: 0, keys: [] };
          const statusBadge = document.createElement('span');
          if (summary.total > 1) {
            statusBadge.className = 'dsh-um-badge dsh-um-badge-active';
            statusBadge.style.cssText = 'background: #0d281e !important; border: 1px solid #1a7f37 !important; color: #3fb950 !important;';
            statusBadge.textContent = '🔄 Key Pool: ' + summary.active + '/' + summary.total + ' Active';
          } else if (summary.total === 1) {
            const isActive = summary.active > 0;
            statusBadge.className = 'dsh-um-badge ' + (isActive ? 'dsh-um-badge-active' : 'dsh-um-badge-pending');
            statusBadge.style.cssText = isActive
              ? 'background: #0d281e !important; border: 1px solid #1a7f37 !important; color: #3fb950 !important;'
              : 'background: #382402 !important; border: 1px solid #9e6a03 !important; color: #d29922 !important;';
            statusBadge.textContent = isActive ? ('1 Key (' + (summary.keys[0]?.masked || 'Đã cài') + ')') : 'Key đang cooldown';
          } else {
            statusBadge.className = 'dsh-um-badge dsh-um-badge-pending';
            statusBadge.style.cssText = 'background: #382402 !important; border: 1px solid #9e6a03 !important; color: #d29922 !important;';
            statusBadge.textContent = 'Chưa có Key';
          }

          const headerRight = document.createElement('div');
          headerRight.style.cssText = 'display: flex; align-items: center; gap: 8px;';
          headerRight.appendChild(statusBadge);

          // Nút xóa Provider hoàn toàn khỏi hệ thống (hiển thị cho provider tùy chỉnh hoặc bất kỳ provider nào)
          const btnDelProv = document.createElement('button');
          btnDelProv.style.cssText = 'background: #261618 !important; border: 1px solid rgba(248, 81, 73, 0.4) !important; color: #f85149 !important; font-size: 11px !important; border-radius: 4px !important; padding: 3px 8px !important; cursor: pointer !important; display: inline-flex !important; align-items: center !important; gap: 3px !important;';
          btnDelProv.textContent = '🗑️ Xóa Provider';
          btnDelProv.title = 'Xóa hoàn toàn Provider này cùng các Model khỏi hệ thống DSH';
          btnDelProv.onclick = async () => {
            if (!confirm('Bạn có chắc muốn xóa vĩnh viễn Provider "' + p.displayName + '" và toàn bộ Model của nó khỏi hệ thống không?')) return;
            await dshUmDeleteProvider(p.id, p.apiKeyEnv);
          };
          headerRight.appendChild(btnDelProv);

          header.appendChild(title);
          header.appendChild(headerRight);
          card.appendChild(header);

          // Models list
          if (p.models && p.models.length > 0) {
            const modelsDiv = document.createElement('div');
            modelsDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';
            modelsDiv.innerHTML = '<span style="font-size: 11px; color: #8b949e !important;">Models:</span> ' +
              p.models.map(m => '<span style="background: #21262d !important; border: 1px solid #30363d !important; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-family: monospace; color: #58a6ff !important;">' + (m.name || m.id) + '</span>').join('');
            card.appendChild(modelsDiv);
          }

          // Active Key Pool Display (if keys exist)
          if (summary.keys && summary.keys.length > 0) {
            const poolDiv = document.createElement('div');
            poolDiv.style.cssText = 'background: #161b22 !important; border: 1px solid #21262d !important; border-radius: 6px !important; padding: 8px 10px !important; display: flex !important; flex-direction: column !important; gap: 6px !important; color: #e6edf3 !important;';
            
            const poolHeader = document.createElement('div');
            poolHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #8b949e !important;';
            poolHeader.innerHTML = '<span>⚡ <strong style="color: #e6edf3 !important;">Danh sách Key trong Pool:</strong> (Tự động xoay khi dính 429)</span>';
            
            if (summary.cooldown > 0) {
              const btnResetCd = document.createElement('button');
              btnResetCd.style.cssText = 'background: #161b22 !important; border: 1px solid #388bfd !important; color: #58a6ff !important; font-size: 10px !important; border-radius: 4px !important; padding: 2px 6px !important; cursor: pointer !important;';
              btnResetCd.textContent = '🔄 Đặt lại Cooldown';
              btnResetCd.onclick = async () => {
                await dshUmResetCooldown(p.apiKeyEnv);
              };
              poolHeader.appendChild(btnResetCd);
            }
            poolDiv.appendChild(poolHeader);

            const keysRow = document.createElement('div');
            keysRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';
            summary.keys.forEach((k, kIdx) => {
              const keyPill = document.createElement('span');
              const isCooling = k.status === 'cooldown';
              keyPill.style.cssText = 'padding: 3px 8px !important; border-radius: 4px !important; font-size: 11px !important; font-family: monospace !important; display: inline-flex !important; align-items: center !important; gap: 4px !important; ' +
                (isCooling ? 'background: #382402 !important; border: 1px solid #9e6a03 !important; color: #d29922 !important;' : 'background: #0d281e !important; border: 1px solid #1a7f37 !important; color: #3fb950 !important;');
              keyPill.innerHTML = (isCooling ? '⏳ ' : '🟢 ') + k.masked + (isCooling ? ' (' + k.cooldownRemainingSec + 's)' : '');

              const btnDelSingle = document.createElement('button');
              btnDelSingle.innerHTML = '&times;';
              btnDelSingle.title = 'Xóa riêng API key này';
              btnDelSingle.style.cssText = 'background: transparent !important; border: none !important; color: #f85149 !important; font-size: 14px !important; font-weight: bold !important; cursor: pointer !important; padding: 0 3px !important; margin-left: 2px !important; line-height: 1 !important;';
              btnDelSingle.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm('Bạn có chắc muốn xóa API key (' + k.masked + ') khỏi pool của ' + p.displayName + '?')) return;
                await dshUmRemoveSingleKey(p.apiKeyEnv, kIdx);
              };
              keyPill.appendChild(btnDelSingle);

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
          input.setAttribute('data-composer-input', 'false');
          input.placeholder = summary.total > 0
            ? 'Nhập thêm API key mới (mỗi key 1 dòng từ các tài khoản khác nhau)...'
            : 'Nhập API key (mỗi key 1 dòng từ các tài khoản khác nhau để xoay vòng tránh 429)...';
          input.style.cssText = 'flex: 1; background: #161b22 !important; background-color: #161b22 !important; border: 1px solid #30363d !important; border-radius: 6px !important; padding: 6px 10px !important; color: #e6edf3 !important; font-size: 11px !important; font-family: monospace !important; resize: vertical !important; min-height: 38px !important;';

          const btnCol = document.createElement('div');
          btnCol.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

          const btnSave = document.createElement('button');
          btnSave.className = 'dsh-um-btn dsh-um-btn-primary';
          btnSave.textContent = '➕ Thêm vào Pool';
          btnSave.title = 'Thêm danh sách API key mới vào Pool (giữ nguyên các key hiện có)';
          btnSave.style.cssText = 'white-space: nowrap !important; font-size: 12px !important; padding: 6px 12px !important; background: #238636 !important; border: 1px solid rgba(240, 246, 252, 0.1) !important; color: #ffffff !important;';
          btnSave.onclick = async () => {
            const val = input.value.trim();
            if (!val) {
              toast('Vui lòng nhập ít nhất 1 API Key!', true);
              return;
            }
            await dshUmSaveApiKey(p.apiKeyEnv, val, 'append');
            input.value = '';
          };
          btnCol.appendChild(btnSave);

          if (summary.total > 0) {
            const btnDelete = document.createElement('button');
            btnDelete.className = 'dsh-um-btn dsh-um-btn-danger';
            btnDelete.textContent = '🗑️ Xóa hết Key';
            btnDelete.title = 'Chỉ xóa toàn bộ danh sách API key trong Pool của provider này (không xóa provider hay model)';
            btnDelete.style.cssText = 'white-space: nowrap !important; font-size: 11px !important; padding: 4px 8px !important; background: #261618 !important; border: 1px solid rgba(248, 81, 73, 0.4) !important; color: #f85149 !important;';
            btnDelete.onclick = async () => {
              if (!confirm('Bạn có chắc muốn xóa toàn bộ key của "' + p.displayName + '" khỏi pool? (Lưu ý: Provider và Model vẫn giữ nguyên, chỉ xóa danh sách key)')) return;
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

    async function dshUmSaveApiKey(ref, value, mode = 'append') {
      try {
        const res = await fetch('/api/admin/models/key', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ ref, value, mode })
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

    async function dshUmRemoveSingleKey(ref, index) {
      try {
        const res = await fetch('/api/admin/models/remove-key', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ ref, index })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message || 'Đã xóa API Key thành công!');
        dshUmLoadModelsConfig();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    }

    async function dshUmDeleteProvider(providerId, apiKeyEnv) {
      try {
        const res = await fetch('/api/admin/models/delete-provider', {
          method: 'POST',
          credentials: 'include',
          headers: getAdminHeaders(),
          body: JSON.stringify({ providerId, apiKeyEnv })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast(data.message || 'Đã xóa Provider thành công!');
        dshUmLoadModelsConfig();
      } catch (e) {
        toast('Lỗi: ' + e.message, true);
      }
    }

    window.dshUmLoadModelsConfig = dshUmLoadModelsConfig;
    window.dshUmSaveApiKey = dshUmSaveApiKey;
    window.dshUmDeleteApiKey = dshUmDeleteApiKey;
    window.dshUmResetCooldown = dshUmResetCooldown;
    window.dshUmRemoveSingleKey = dshUmRemoveSingleKey;
    window.dshUmDeleteProvider = dshUmDeleteProvider;

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
      if (document.getElementById('dsh-um-settings-bridge-btn')) return;

      const dialogs = document.querySelectorAll('[role="dialog"], [class*="settings" i], [class*="modal" i]');
      for (const diag of dialogs) {
        if (diag.id === 'dsh-um-admin-modal') continue;
        const addProviderBtn = Array.from(diag.querySelectorAll('button')).find(b => (b.textContent || '').includes('Add model provider'));
        if (addProviderBtn) {
          const contentArea = addProviderBtn.parentElement;
          if (contentArea && !document.getElementById('dsh-um-settings-bridge-btn')) {
            const openBtn = document.createElement('button');
            openBtn.id = 'dsh-um-settings-bridge-btn';
            openBtn.type = 'button';
            openBtn.style.cssText = 'background: #8b5cf6; color: white; border: none; border-radius: 6px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(139,92,246,0.35); margin-bottom: 14px; transition: all 0.2s;';
            openBtn.textContent = '👑 Mở cấu hình Key Pool';
            openBtn.onmouseover = function() { openBtn.style.filter = 'brightness(1.15)'; };
            openBtn.onmouseout = function() { openBtn.style.filter = 'brightness(1)'; };
            openBtn.onclick = function() {
              dshUmOpenAdmin();
              dshUmSwitchAdminTab('models');
            };

            contentArea.insertBefore(openBtn, contentArea.firstChild);
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

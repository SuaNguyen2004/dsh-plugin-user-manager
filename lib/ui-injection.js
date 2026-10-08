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

          // Auto-expand folder once so user immediately sees past sessions
          if (wsRow.getAttribute('aria-expanded') === 'false' && !window._dshWsExpandedOnce) {
            window._dshWsExpandedOnce = true;
            setTimeout(() => {
              try { wsRow.click(); } catch (e) {}
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

      // 2. If center hero has no active workspace session, auto-click user's new session button in sidebar
      const mySidebarRow = document.querySelector('[data-row-key="workspace:user-workspace-' + u + '"]');
      if (mySidebarRow && !window._dshSwitchedInitialSession) {
        const heroWsBtns = document.querySelectorAll('[class*="heroWorkspaceRow"] button, [class*="workspaceRow"] button');
        const heroText = Array.from(heroWsBtns).map(b => (b.textContent || '').toLowerCase()).join(' ');
        if (!heroText.includes('(' + u + ')')) {
          window._dshSwitchedInitialSession = true;
          const newSessionBtn = Array.from(mySidebarRow.querySelectorAll('button')).find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return label.includes('session') || label.includes('chat') || label.includes('phiên');
          }) || mySidebarRow.querySelector('button:last-child');

          if (newSessionBtn) {
            try {
              newSessionBtn.click();
            } catch (e) {}
          }
        }
      }

      // 4. Filter open menu items: only allow selecting user's own workspace
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      menuItems.forEach(item => {
        const text = (item.textContent || '').toLowerCase();
        if (text.includes('add workspace') || text.includes('add workspace…') || text.includes('khách') || text.includes('guest') || text.includes('ungrouped')) {
          item.style.setProperty('display', 'none', 'important');
        } else if (text.includes('workspace (')) {
          if (!text.includes('(' + u + ')')) {
            item.style.setProperty('display', 'none', 'important');
          } else {
            item.style.removeProperty('display');
          }
        }
      });
    }

    // Logout
    window.dshUmLogout = async function() {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (e) {}

      localStorage.removeItem('dsh_user_token');
      localStorage.removeItem('dsh_user_info');
      localStorage.removeItem('dsh.sessions.current');
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('dsh.') || k.includes('session') || k.includes('user'))) {
          localStorage.removeItem(k);
        }
      }
      sessionStorage.clear();
      document.cookie = 'dsh_user_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';

      toast('Đã đăng xuất! Đang chuyển về trang đăng nhập...');
      setTimeout(() => {
        window.location.href = '/login?logout=1';
      }, 300);
    };

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
      const viewPending = document.getElementById('dsh-um-admin-pending-view');
      const viewAll = document.getElementById('dsh-um-admin-all-view');

      if (tab === 'pending') {
        tabPending.classList.add('active');
        tabAll.classList.remove('active');
        viewPending.style.display = 'block';
        viewAll.style.display = 'none';
        dshUmLoadPendingUsers();
      } else {
        tabAll.classList.add('active');
        tabPending.classList.remove('active');
        viewPending.style.display = 'none';
        viewAll.style.display = 'block';
        dshUmLoadAllUsers();
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

    // Dynamic MutationObserver to maintain isolation as React re-renders
    const observer = new MutationObserver(() => {
      applyWorkspaceIsolation();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();
</script>
<!-- === END DSH USER MANAGER NATIVE UI INJECTION === -->
`;
}

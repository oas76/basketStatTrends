// ========================================
// PLATFORM ADMIN
// ========================================
// Platform-level administration: user accounts, audit log, storage / Blob sync
// diagnostics, and team create/rename/delete. Team-scoped work (games, players,
// competitions, members) lives on admin.html / admin.js.

// Escape untrusted values before inserting into innerHTML (prevents XSS)
const escapeHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

const openModal = (el) => el && el.classList.add('active');
const closeModal = (el) => el && el.classList.remove('active');

// ========================================
// STORAGE / BLOB SYNC (active team push/pull + diagnostics)
// ========================================

const cloudBadge = document.getElementById('cloudBadge');
const cloudStatus = document.getElementById('cloudStatus');
const cloudDetails = document.getElementById('cloudDetails');
const storageDiag = document.getElementById('storageDiag');
const cloudSyncUpBtn = document.getElementById('cloudSyncUp');
const cloudSyncDownBtn = document.getElementById('cloudSyncDown');

const setCloudStatus = (label, detail) => {
  if (cloudStatus) cloudStatus.textContent = label;
  if (cloudDetails) cloudDetails.textContent = detail || '';
};

// Reflect the active team + storage config in the Blob sync card.
const updateCloudSyncUI = async () => {
  const ctx = window.BasketTeams || {};
  const active = (ctx.list || []).find(t => t.id === ctx.activeId);
  const hasTeam = !!active;

  if (cloudBadge) {
    cloudBadge.textContent = hasTeam ? `Active: ${active.name}` : 'No active team';
    cloudBadge.className = hasTeam ? 'badge connected' : 'badge';
  }
  if (cloudSyncUpBtn) cloudSyncUpBtn.disabled = !hasTeam;
  if (cloudSyncDownBtn) cloudSyncDownBtn.disabled = !hasTeam;
};

// Render durable-storage diagnostics from the /api/users storage descriptor.
const renderStorageDiag = (storage) => {
  if (!storageDiag) return;
  if (!storage) {
    storageDiag.innerHTML = '';
    return;
  }
  if (storage.configured) {
    storageDiag.innerHTML =
      `<span style="color: var(--positive);">● Durable store active</span> (${escapeHtml(storage.mode || 'blob')})`;
    return;
  }
  storageDiag.innerHTML =
    '<span style="color:#f87171;">⚠️ No durable store configured (' +
    escapeHtml(storage.mode || 'unknown') +
    '). Accounts and team data will not persist. Attach a Vercel Blob store and redeploy.</span>';
};

if (cloudSyncUpBtn) {
  cloudSyncUpBtn.addEventListener('click', async () => {
    if (!window.basketStatData.getActiveTeam()) {
      setCloudStatus('Error', 'No active team selected');
      return;
    }
    try {
      cloudSyncUpBtn.disabled = true;
      const localData = window.basketStatData.loadData();
      const ok = await window.basketStatData.saveToServer();
      if (!ok) throw new Error('Server rejected the save');
      setCloudStatus('Saved', `${localData.games.length} games saved to team storage`);
    } catch (error) {
      setCloudStatus('Save failed', error.message);
    } finally {
      cloudSyncUpBtn.disabled = false;
      await updateCloudSyncUI();
    }
  });
}

if (cloudSyncDownBtn) {
  cloudSyncDownBtn.addEventListener('click', async () => {
    const teamId = window.basketStatData.getActiveTeam();
    if (!teamId) {
      setCloudStatus('Error', 'No active team selected');
      return;
    }
    try {
      cloudSyncDownBtn.disabled = true;
      const data = await window.basketStatData.hydrateTeam(teamId);
      if (!data) throw new Error('Failed to load team data');
      setCloudStatus('Loaded', `${data.games.length} games loaded from team storage`);
    } catch (error) {
      setCloudStatus('Load failed', error.message);
    } finally {
      cloudSyncDownBtn.disabled = false;
    }
  });
}

// ========================================
// AUDIT LOG
// ========================================

const auditLogTable = document.getElementById('auditLogTable');
const refreshAuditLog = document.getElementById('refreshAuditLog');

const formatTimestamp = (isoString) => {
  const date = new Date(isoString);
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const loadAuditLog = async () => {
  if (!auditLogTable) return;
  auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading...</td></tr>';
  try {
    const response = await fetch('/api/audit-log?limit=100');
    if (!response.ok) {
      if (response.status === 403) {
        auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Admin access required</td></tr>';
        return;
      }
      throw new Error('Failed to load audit log');
    }
    const data = await response.json();
    if (data.entries.length === 0) {
      auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No audit entries yet</td></tr>';
      return;
    }
    auditLogTable.innerHTML = data.entries.map(entry => {
      const statusClass = entry.success ? 'color: var(--positive)' : 'color: var(--negative)';
      const statusText = entry.success ? '✓ Success' : '✗ Failed';
      const email = escapeHtml(entry.email || entry.emailHash || '—');
      return `
        <tr>
          <td style="white-space: nowrap; font-size: 12px;">${escapeHtml(formatTimestamp(entry.timestamp))}</td>
          <td><code style="font-size: 11px; background: var(--surface-raised); padding: 2px 6px; border-radius: 4px;">${escapeHtml(entry.action)}</code></td>
          <td style="font-size: 12px;">${email}</td>
          <td style="font-size: 12px;">${escapeHtml(entry.role || '—')}</td>
          <td style="font-size: 11px; color: var(--text-muted);">${escapeHtml(entry.ip || '—')}</td>
          <td style="${statusClass}; font-size: 12px;">${statusText}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Failed to load audit log:', error);
    auditLogTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--negative);">Failed to load audit log</td></tr>';
  }
};

if (refreshAuditLog) refreshAuditLog.addEventListener('click', loadAuditLog);

// ========================================
// USER MANAGEMENT
// ========================================

const usersTable = document.getElementById('usersTable');
const userCount = document.getElementById('userCount');
const addUserBtn = document.getElementById('addUserBtn');
const addUserModal = document.getElementById('addUserModal');
const addUserForm = document.getElementById('addUserForm');
const closeAddUser = document.getElementById('closeAddUser');
const cancelAddUser = document.getElementById('cancelAddUser');
const addUserError = document.getElementById('addUserError');
const passwordModal = document.getElementById('passwordModal');
const generatedPassword = document.getElementById('generatedPassword');
const copyPasswordBtn = document.getElementById('copyPasswordBtn');
const closePasswordModal = document.getElementById('closePasswordModal');
const donePasswordModal = document.getElementById('donePasswordModal');

const PROVIDER_LABELS = { google: 'Google', apple: 'Apple', vipps: 'Vipps' };

const renderUsers = (users) => {
  if (!usersTable) return;
  if (userCount) userCount.textContent = users.length;

  if (users.length === 0) {
    usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No users yet</td></tr>';
    return;
  }

  usersTable.innerHTML = users.map((u) => {
    const roleBadge = u.role === 'admin'
      ? '<span class="badge" style="background: var(--accent-dim); color: var(--accent);">admin</span>'
      : `<span class="badge">${escapeHtml(u.role || 'user')}</span>`;
    const statusBadge = u.status === 'active'
      ? '<span style="color: var(--positive); font-size:12px;">● active</span>'
      : '<span style="color: var(--text-muted); font-size:12px;">○ disabled</span>';

    const signins = [];
    if (u.hasPassword) signins.push('<span class="badge" style="font-size:10px;">password</span>');
    (u.providers || []).forEach((p) => {
      signins.push(
        `<span class="badge" style="font-size:10px;">${escapeHtml(PROVIDER_LABELS[p] || p)}` +
        ` <a href="#" data-action="unlink" data-id="${escapeHtml(u.id)}" data-provider="${escapeHtml(p)}" title="Unlink ${escapeHtml(PROVIDER_LABELS[p] || p)}" style="color: var(--negative); text-decoration:none;">×</a></span>`
      );
    });
    const signinCell = signins.length ? signins.join(' ') : '<span style="color: var(--text-muted); font-size:11px;">—</span>';

    let roleAction;
    if (u.role === 'admin') {
      roleAction = `<button class="secondary" data-action="make-user" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make user</button>`;
    } else {
      const recorderToggle = u.role === 'recorder'
        ? `<button class="secondary" data-action="make-user" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make user</button>`
        : `<button class="secondary" data-action="make-recorder" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make recorder</button>`;
      roleAction = `<button class="secondary" data-action="make-admin" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Make admin</button>${recorderToggle}`;
    }
    const statusAction = u.status === 'active'
      ? `<button class="secondary" data-action="disable" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Disable</button>`
      : `<button class="secondary" data-action="enable" data-id="${escapeHtml(u.id)}" style="font-size:11px; padding:4px 8px;">Enable</button>`;

    return `
      <tr data-id="${escapeHtml(u.id)}">
        <td style="font-size:12px;">${escapeHtml(u.email)}</td>
        <td style="font-size:12px;">${escapeHtml(u.name) || '—'}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${signinCell}</td>
        <td style="white-space:nowrap; display:flex; gap:4px; flex-wrap:wrap;">
          <button class="secondary" data-action="regenerate" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" style="font-size:11px; padding:4px 8px;">🔑 Password</button>
          ${roleAction}
          ${statusAction}
          <button data-action="delete" data-id="${escapeHtml(u.id)}" data-email="${escapeHtml(u.email)}" class="danger-link" style="font-size:11px; padding:4px 8px;">Delete</button>
        </td>
      </tr>`;
  }).join('');
};

const loadUsers = async () => {
  if (!usersTable) return;
  usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Loading...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (!res.ok) {
      if (res.status === 403) {
        usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Admin access required</td></tr>';
        return;
      }
      throw new Error('Failed to load users');
    }
    const data = await res.json();
    renderUsers(data.users || []);
    renderStorageDiag(data.storage);
  } catch (e) {
    console.error('Failed to load users:', e);
    usersTable.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--negative);">Failed to load users</td></tr>';
  }
};

const showPassword = (password) => {
  if (generatedPassword) generatedPassword.value = password;
  openModal(passwordModal);
};

if (addUserBtn) addUserBtn.addEventListener('click', () => {
  addUserForm.reset();
  addUserError.style.display = 'none';
  openModal(addUserModal);
});
if (closeAddUser) closeAddUser.addEventListener('click', () => closeModal(addUserModal));
if (cancelAddUser) cancelAddUser.addEventListener('click', () => closeModal(addUserModal));

if (addUserForm) addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addUserError.style.display = 'none';
  const email = document.getElementById('newUserEmail').value.trim();
  const name = document.getElementById('newUserName').value.trim();
  const role = document.getElementById('newUserRole').value;
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role })
    });
    const data = await res.json();
    if (!res.ok) {
      addUserError.textContent = data.error || 'Failed to create user';
      addUserError.style.display = 'block';
      return;
    }
    closeModal(addUserModal);
    await loadUsers();
    showPassword(data.password);
  } catch (err) {
    addUserError.textContent = 'Connection error. Please try again.';
    addUserError.style.display = 'block';
  }
});

if (copyPasswordBtn) copyPasswordBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(generatedPassword.value);
    copyPasswordBtn.textContent = 'Copied!';
    setTimeout(() => { copyPasswordBtn.textContent = 'Copy'; }, 1500);
  } catch {
    generatedPassword.select();
  }
});
if (closePasswordModal) closePasswordModal.addEventListener('click', () => closeModal(passwordModal));
if (donePasswordModal) donePasswordModal.addEventListener('click', () => closeModal(passwordModal));

if (usersTable) usersTable.addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-action]');
  if (!trigger) return;
  e.preventDefault();
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;
  const email = trigger.dataset.email || '';

  try {
    if (action === 'regenerate') {
      if (!confirm(`Generate a new password for ${email}? The old one stops working immediately.`)) return;
      const res = await fetch(`/api/users/${id}/regenerate-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to regenerate password');
      showPassword(data.password);
    } else if (action === 'make-admin' || action === 'make-user' || action === 'make-recorder') {
      const role = action === 'make-admin' ? 'admin' : (action === 'make-recorder' ? 'recorder' : 'user');
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to update role');
      await loadUsers();
    } else if (action === 'disable' || action === 'enable') {
      const status = action === 'disable' ? 'disabled' : 'active';
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to update status');
      await loadUsers();
    } else if (action === 'delete') {
      if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to delete user');
      await loadUsers();
    } else if (action === 'unlink') {
      const provider = trigger.dataset.provider;
      if (!confirm(`Unlink ${PROVIDER_LABELS[provider] || provider} sign-in from this user?`)) return;
      const res = await fetch(`/api/users/${id}/identities/${provider}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to unlink');
      await loadUsers();
    }
  } catch (err) {
    console.error('User action error:', err);
    alert('Something went wrong. Please try again.');
  }
});

[addUserModal, passwordModal].forEach((m) => {
  if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(addUserModal); closeModal(passwordModal); }
});

// ========================================
// TEAMS CRUD (create / rename / delete)
// ========================================

const teamsCard = document.getElementById('teamsCard');
const teamsTable = document.getElementById('teamsTable');
const teamCountEl = document.getElementById('teamCount');
const addTeamBtn = document.getElementById('addTeamBtn');

let teamsCache = [];

async function loadTeamsAdmin() {
  try {
    const res = await fetch('/api/teams');
    if (!res.ok) return;
    const data = await res.json();
    teamsCache = data.teams || [];
    renderTeamsTable(teamsCache);
  } catch (e) {
    console.error('Failed to load teams:', e);
  }
}

function renderTeamsTable(teams) {
  if (teamCountEl) teamCountEl.textContent = teams.length;
  if (!teamsTable) return;
  if (!teams.length) {
    teamsTable.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No teams yet</td></tr>';
    return;
  }
  teamsTable.innerHTML = teams.map((t) => `
    <tr data-id="${escapeHtml(t.id)}">
      <td style="font-size:13px; font-weight:500;">${escapeHtml(t.name)}</td>
      <td style="font-size:12px; color:var(--text-muted);">${t.createdAt ? escapeHtml(new Date(t.createdAt).toLocaleDateString()) : '—'}</td>
      <td style="white-space:nowrap; display:flex; gap:4px;">
        <button class="secondary" data-taction="rename" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" style="font-size:11px; padding:4px 8px;">Rename</button>
        <button class="danger-link" data-taction="delete-team" data-id="${escapeHtml(t.id)}" data-name="${escapeHtml(t.name)}" style="font-size:11px; padding:4px 8px;">Delete</button>
      </td>
    </tr>`).join('');
}

if (addTeamBtn) addTeamBtn.addEventListener('click', async () => {
  const name = prompt('New team name:');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to create team');
    window.location.reload();
  } catch (e) {
    alert('Failed to create team. Please try again.');
  }
});

if (teamsTable) teamsTable.addEventListener('click', async (e) => {
  const trigger = e.target.closest('[data-taction]');
  if (!trigger) return;
  const action = trigger.dataset.taction;
  const id = trigger.dataset.id;
  const name = trigger.dataset.name || '';

  if (action === 'rename') {
    const next = prompt('Rename team:', name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === name) return;
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to rename team');
      window.location.reload();
    } catch (err) {
      alert('Failed to rename team.');
    }
  } else if (action === 'delete-team') {
    if (!confirm(`Delete team "${name}"? This permanently removes its games and stats and cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'Failed to delete team');
      window.location.reload();
    } catch (err) {
      alert('Failed to delete team.');
    }
  }
});

// ========================================
// INIT
// ========================================

(async () => {
  try {
    if (window.basketStatReady) await window.basketStatReady;
  } catch (e) {
    console.warn('Team bootstrap failed on platform-admin page:', e);
  }
  await updateCloudSyncUI();
  loadUsers();
  loadAuditLog();
  loadTeamsAdmin();
})();

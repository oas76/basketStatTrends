// ========================================
// BASKETSTAT CLIENT CONFIGURATION
// ========================================
// API keys are now stored server-side in .env (not exposed to browser)
// This file only contains client-side behavior settings

const CLOUD_CONFIG = {
  // Auto-sync settings (server handles the actual API calls securely)
  autoLoadOnStart: true,  // Automatically load data from cloud when page loads
  autoSaveOnChange: false // Automatically save to cloud when data changes (be careful with rate limits)
};

// Make config available globally
window.CLOUD_CONFIG = CLOUD_CONFIG;

// ========================================
// AUTHENTICATION UTILITIES
// ========================================

/**
 * Logout function - clears session and redirects to login
 */
async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.error('Logout error:', e);
  }
  // Clear any client-side session storage
  sessionStorage.clear();
  // Redirect to login page
  window.location.href = '/login.html';
}

// Make logout available globally
window.logout = logout;

// ========================================
// TEAM CONTEXT + ROLE-BASED UI
// ========================================
// Shared multi-team bootstrap. Resolves the caller's role + accessible teams,
// picks an active team, and hydrates its data from the server BEFORE any page
// renders. Pages await `window.basketStatReady` so they render the correct
// team's data. The result is also used to render the team switcher and to
// show/hide admin-only nav.

// NOTE: data.js also defines its own ACTIVE_TEAM_KEY; classic scripts share one
// global lexical scope, so we use a distinct name here to avoid redeclaration.
const ACTIVE_TEAM_STORAGE_KEY = 'basketstat-active-team';

// Shared context, populated by bootstrap.
window.BasketTeams = { role: null, list: [], activeId: null, ready: null };

function readStoredActiveTeam() {
  try {
    return localStorage.getItem(ACTIVE_TEAM_STORAGE_KEY) || null;
  } catch (e) {
    return null;
  }
}

async function bootstrapTeamContext() {
  let info = null;
  try {
    const res = await fetch('/api/auth/check');
    if (res.ok) info = await res.json();
  } catch (e) {
    console.error('Auth check error:', e);
  }
  if (!info || !info.authenticated) return info;

  window.BasketTeams.role = info.role;
  const teams = Array.isArray(info.teams) ? info.teams : [];
  window.BasketTeams.list = teams;

  if (teams.length > 0) {
    const stored = readStoredActiveTeam();
    const active = teams.some(t => t.id === stored) ? stored : teams[0].id;
    window.BasketTeams.activeId = active;
    // Hydrate the active team's data from the server (source of truth).
    if (window.basketStatData && window.basketStatData.hydrateTeam) {
      await window.basketStatData.hydrateTeam(active);
    } else {
      try { localStorage.setItem(ACTIVE_TEAM_STORAGE_KEY, active); } catch (e) { /* ignore */ }
    }
  } else {
    window.BasketTeams.activeId = null;
    if (window.basketStatData && window.basketStatData.setActiveTeam) {
      window.basketStatData.setActiveTeam(null);
    }
  }
  return info;
}

// Start immediately so hydration overlaps with page parsing. Pages await this.
window.basketStatReady = bootstrapTeamContext();

/**
 * Render the team switcher into the page header and toggle admin-only links.
 * Runs after the DOM is ready and the context has resolved.
 */
async function applyTeamUI() {
  // Hide settings links until confirmed admin (avoids flash for non-admins).
  document.querySelectorAll('.settings-link').forEach(el => { el.style.display = 'none'; });

  await window.basketStatReady;

  if (window.BasketTeams.role === 'admin') {
    document.querySelectorAll('.settings-link').forEach(el => { el.style.display = ''; });
  }

  renderTeamSwitcher();
}

function renderTeamSwitcher() {
  const nav = document.querySelector('.app-header nav');
  if (!nav) return;
  const teams = window.BasketTeams.list || [];

  // Nothing to switch between and not an admin -> no control.
  if (teams.length === 0) return;

  let wrap = document.getElementById('teamSwitcher');
  if (!wrap) {
    wrap = document.createElement('select');
    wrap.id = 'teamSwitcher';
    wrap.title = 'Active team';
    wrap.style.cssText =
      'background: var(--panel, #1b2233); color: var(--text, #e6e9f0); ' +
      'border: 1px solid var(--border, #2b3348); border-radius: 8px; ' +
      'padding: 6px 10px; font-size: 13px; font-weight: 500; cursor: pointer; margin-right: 4px;';
    nav.insertBefore(wrap, nav.firstChild);
    wrap.addEventListener('change', () => {
      const id = wrap.value;
      try { localStorage.setItem(ACTIVE_TEAM_STORAGE_KEY, id); } catch (e) { /* ignore */ }
      // Reload so every page re-hydrates from the newly active team.
      window.location.reload();
    });
  }

  wrap.innerHTML = '';
  teams.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    const roles = t.roles || (t.role ? [t.role] : []);
    opt.textContent = t.name + (roles.includes('admin') ? ' (admin)' : '');
    if (t.id === window.BasketTeams.activeId) opt.selected = true;
    wrap.appendChild(opt);
  });
}

document.addEventListener('DOMContentLoaded', applyTeamUI);

// ========================================
// STAT INFO TOOLTIPS
// ========================================

/**
 * Extra formula/context info for stats not fully described by reference-stats.js
 */
const STAT_FORMULAS = {
  'reb':   'OREB + DREB',
  'a/to':  'AST ÷ TO',
  'atk':   'FGA + FTA + AST + OREB',
  'def':   '(BLK + STL + DREB) × Foul Multiplier\n3 fouls = ×1.25 · 2 fouls = ×1.0 · 4 fouls = ×0.85 · 0/1/5 = ×0.70',
  'shoot': 'Avg(FG%, 3PT%, FT%) — only shot types with ≥1 attempt are counted',
  'foul':  '3 fouls = optimal · 0-1 = passive · 5 = fouled out',
  'to':    'Lower is better',
};

/**
 * Initialise the shared floating stat-info tooltip.
 * Any element with [data-stat-tooltip="statKey"] gets hover info
 * drawn from reference-stats.js + STAT_FORMULAS above.
 */
function initStatTooltips() {
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-info-tooltip';
  tooltip.innerHTML =
    '<div class="stat-info-tooltip-name"></div>' +
    '<div class="stat-info-tooltip-desc"></div>' +
    '<div class="stat-info-tooltip-formula"></div>';
  document.body.appendChild(tooltip);

  const nameEl    = tooltip.querySelector('.stat-info-tooltip-name');
  const descEl    = tooltip.querySelector('.stat-info-tooltip-desc');
  const formulaEl = tooltip.querySelector('.stat-info-tooltip-formula');

  let hideTimer;

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-stat-tooltip]');
    if (!target) return;

    clearTimeout(hideTimer);
    const key = target.dataset.statTooltip;
    const ref = window.referenceStats?.getStatReference(key);
    const formula = STAT_FORMULAS[key] || null;

    if (!ref && !formula) return;

    nameEl.textContent = ref?.name || key.toUpperCase();

    const parts = [];
    if (ref?.description) parts.push(ref.description);
    if (ref?.unit)        parts.push(ref.unit);
    descEl.textContent = parts.join(' · ');

    if (formula) {
      formulaEl.textContent = formula;
      formulaEl.style.display = 'block';
    } else {
      formulaEl.style.display = 'none';
    }

    // Position: below the element, centered, clamped to viewport
    const rect = target.getBoundingClientRect();
    const W = 230;
    let left = rect.left + rect.width / 2 - W / 2;
    let top  = rect.bottom + 8;

    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    if (top + 120 > window.innerHeight) top = rect.top - 128;

    tooltip.style.left  = left + 'px';
    tooltip.style.top   = top  + 'px';
    tooltip.classList.add('visible');
  });

  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest('[data-stat-tooltip]')) return;
    hideTimer = setTimeout(() => tooltip.classList.remove('visible'), 120);
  });
}

document.addEventListener('DOMContentLoaded', initStatTooltips);

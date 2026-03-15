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
// ROLE-BASED UI
// ========================================

/**
 * Hide settings links for non-admin users.
 * Elements with class "settings-link" are hidden until the role is confirmed as admin.
 */
async function applyRoleBasedUI() {
  // Hide immediately to avoid flash of the link for non-admins
  document.querySelectorAll('.settings-link').forEach(el => {
    el.style.display = 'none';
  });

  try {
    const res = await fetch('/api/auth/check');
    if (res.ok) {
      const { role } = await res.json();
      if (role === 'admin') {
        document.querySelectorAll('.settings-link').forEach(el => {
          el.style.display = '';
        });
      }
    }
  } catch (e) {
    console.error('Auth check error:', e);
  }
}

document.addEventListener('DOMContentLoaded', applyRoleBasedUI);

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

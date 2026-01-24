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

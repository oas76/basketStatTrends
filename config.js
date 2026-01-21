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

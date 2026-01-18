// ========================================
// BASKETSTAT CLOUD CONFIGURATION
// ========================================
// Set these values once, then deploy with your site.
// All users will share the same data.

const CLOUD_CONFIG = {
  // JSONbin.io settings
  // Get your API key at: https://jsonbin.io/app/api-keys
  apiKey: "$2a$10$gmo/1YRXg4Ovg/hNsgmwfe2XACdtrqQ5XvG2tkr9PoNdSXxMjOgl.", // Your X-Master-Key (leave empty to disable cloud sync)
  
  // Bin ID - leave empty on first deploy, then fill in after first upload
  // The bin ID will be shown in the console after first successful upload
  binId: "696d45a6ae596e708fe53000",
  
  // Auto-sync settings
  autoLoadOnStart: true,  // Automatically load data from cloud when page loads
  autoSaveOnChange: false // Automatically save to cloud when data changes (be careful with rate limits)
};

// Make config available globally
window.CLOUD_CONFIG = CLOUD_CONFIG;

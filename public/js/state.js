// Proxy-based reactive store + navigation helpers
// Shared across all module files in the user SPA.

export const Store = new Proxy({ user: null }, {
  set(target, key, value) {
    target[key] = value;
    document.dispatchEvent(new CustomEvent('statechange', { detail: { key, value } }));
    return true;
  }
});

let pendingHashNavigation = null;

export function clearPendingHashNavigation() {
  if (pendingHashNavigation) {
    clearTimeout(pendingHashNavigation);
    pendingHashNavigation = null;
  }
}

export function scheduleHashNavigation(hash, delayMs) {
  clearPendingHashNavigation();
  pendingHashNavigation = setTimeout(() => {
    pendingHashNavigation = null;
    location.hash = hash;
  }, delayMs);
}

// Handle non-hash URLs: redirect /login to #/login, /register to #/register
// This allows MindAuth to work with direct URL paths like /login?redirect=...
(function handleDirectUrls() {
  const path = window.location.pathname;
  const search = window.location.search;

  // Supported direct paths: /login, /register, /logout
  const supportedPaths = ['login', 'register', 'logout'];

  for (const supportedPath of supportedPaths) {
    if (path === '/' + supportedPath || path === supportedPath) {
      // Redirect to hash format after all scripts have loaded
      // Use setTimeout to ensure this runs after DOMContentLoaded handlers
      setTimeout(() => {
        const newHash = '/#/' + supportedPath + (search || '');
        // Use replace to avoid adding history entry
        window.location.replace(newHash);
      }, 0);
      return; // Stop IIFE execution, don't run rest of the script yet
    }
  }
})();

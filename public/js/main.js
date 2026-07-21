// User SPA entry point.
// Imports all module pieces and kicks off initialization.

import { router } from './router.js';
import { checkAuth } from './auth.js';
import { setupEventHandlers } from './handlers.js';

// Wire up event listeners (form submit, click delegation, file inputs).
setupEventHandlers();

// Initialize: auth check + initial route.
// Handle both cases: DOMContentLoaded already fired or not yet.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    router();
  });
} else {
  // DOMContentLoaded already fired, run immediately
  (async () => {
    await checkAuth();
    router();
  })();
}

// Re-run router on hash change.
window.addEventListener('hashchange', router);

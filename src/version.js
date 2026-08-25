// ============================================================
// VERSION — single source of truth for the app version string.
// Consumed by:
//   - script.js → footer text (#appVersion) + CSV export "App version" row
//   - sw.js     → CACHE name literal (kept in sync, enforced by the test below)
//   - test/version.test.js → fails `npm test` if package.json / sw.js drift
//
// Bump APP_VERSION on every deploy that changes shipped assets, and bump the
// matching `csa-vX.Y.Z` literal in public/sw.js so old clients drop their stale
// cache (see CLAUDE.md). The version test guarantees the two never disagree.
// Imported by main.js (footer), app.js (CSV row); test/version.test.js reads it.
// ============================================================

export const APP_VERSION = '1.22.0';

// Also expose as a global on the SW's self object so the service worker
// (which is not an ES module here) can reference it. No-op in Node tests
// where `self` is undefined. Regular page code should `import { APP_VERSION }`.
if (typeof self !== 'undefined') self.APP_VERSION = APP_VERSION;

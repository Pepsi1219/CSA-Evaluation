// ============================================================
// VERSION — single source of truth for the app version string.
// Consumed by:
//   - main.js → footer text (#appVersion); app.js → CSV export version row
//   - src/sw.js → CACHE name literal, kept in sync by test/version.test.js
//   - index.html footer fallback, package.json, and package-lock.json
//
// Increment the patch segment for every app change and synchronize every
// mirror above; test/version.test.js verifies that they all match.
// Imported by main.js (footer), app.js (CSV row); test/version.test.js reads it.
// ============================================================

export const APP_VERSION = '1.30.12';

// Also expose as a global on the SW's self object so the service worker
// (which is not an ES module here) can reference it. No-op in Node tests
// where `self` is undefined. Regular page code should `import { APP_VERSION }`.
if (typeof self !== 'undefined') self.APP_VERSION = APP_VERSION;

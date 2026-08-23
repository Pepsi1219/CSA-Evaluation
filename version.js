// ============================================================
// VERSION — single source of truth for the app version string.
// Consumed by:
//   - script.js → footer text (#appVersion) + CSV export "App version" row
//   - sw.js     → CACHE name literal (kept in sync, enforced by the test below)
//   - test/version.test.js → fails `npm test` if package.json / sw.js drift
//
// Bump APP_VERSION on every deploy that changes shipped assets, and bump the
// matching `csa-vX.Y.Z` literal in sw.js so old clients drop their stale cache
// (see CLAUDE.md). The version test guarantees the two never disagree again.
// Loaded first (before every other script) in index.html so the global exists
// for all consumers; also require()-able from Node for the test.
// ============================================================

const APP_VERSION = '1.18.0';

// Expose as a browser/worker global (self === window in a page, === the SW
// global in a worker). No-op under Node, where `self` is undefined.
if (typeof self !== 'undefined') self.APP_VERSION = APP_VERSION;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { APP_VERSION };
}

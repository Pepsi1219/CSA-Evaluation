// ============================================================
// MAIN — entry point. Loaded as the single <script type="module">
// in index.html. Responsibilities:
//   1. Register the service worker
//   2. Stamp the footer version + install no-zoom guards
//   3. Run app init (theme / GA / restore state / language / calc)
//   4. Wire pagehide / visibilitychange flush
//   5. Import wiring.js — binds every former inline handler via
//      data-action delegation (no window.* bridge).
// ============================================================
import { APP_VERSION } from './version.js';
import { translations } from './translations.js';
import {
    initGA4, initTheme, restoreFormState, restoreStopwatchState,
    _bumpSessionCount, drainFeedbackQueue, showOnboardingIfNeeded,
    changeLanguage, calculateAll, _flushHeavyUpdate, loadWebFonts,
} from './app.js';
import { updateTutProgressBadge } from './tutorial.js';
import './wiring.js';

// --- Service worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// --- Footer version stamp (single source of truth = version.js) ---
const _appVersionEl = document.getElementById('appVersion');
if (_appVersionEl) _appVersionEl.textContent = 'v' + APP_VERSION;

// --- Native-app feel: no zoom (iOS Safari falls through the meta + CSS guards) ---
['gesturestart', 'gesturechange', 'gestureend'].forEach(evt =>
    document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

// --- Init sequence (order matters — matches original script.js bottom block) ---
initGA4();
initTheme();
restoreFormState();
restoreStopwatchState();
_bumpSessionCount();
drainFeedbackQueue();
showOnboardingIfNeeded();
updateTutProgressBadge();
const _savedLang = (() => { try { return localStorage.getItem('csa_lang'); } catch { return null; } })();
changeLanguage(_savedLang && translations[_savedLang] ? _savedLang : 'th');
calculateAll();
_flushHeavyUpdate();
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

// --- Flush pending debounced saves before hide/unload ---
window.addEventListener('pagehide', _flushHeavyUpdate);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushHeavyUpdate();
});

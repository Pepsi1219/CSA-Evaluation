// ============================================================
// MAIN — entry point. Loaded as the single <script type="module">
// in index.html. Three-phase boot:
//   A (always): SW register, version stamp, no-zoom guards, theme +
//               language — so the login overlay is themed/translated.
//   B (async):  init Firebase, watch auth state. No user → show login
//               overlay; user → enterApp once; sign-out mid-session →
//               reload (so no data bleeds across accounts).
//   C enterApp: subscribe history, await first snapshot, migrate this
//               device's local history, hide overlay, run the rest of
//               app init (form/stopwatch restore, calc, fonts).
// When Firebase isn't configured (no .env), FIREBASE_ENABLED is false and
// we boot straight into the app with localStorage history (Phase 1 behaviour).
// ============================================================
import { APP_VERSION } from './version.js';
import { translations } from './translations.js';
import {
    initGA4, initTheme, restoreFormState, restoreStopwatchState,
    _bumpSessionCount, drainFeedbackQueue, showOnboardingIfNeeded,
    changeLanguage, calculateAll, _flushHeavyUpdate, loadWebFonts,
} from './app.js';
import { t } from './state.js';
import { updateTutProgressBadge } from './tutorial.js';
import {
    FIREBASE_ENABLED, initFirebase, onAuthChange, subscribeHistory,
    migrateLocalHistory, _setCurrentUser, signInWithCode, authErrorKey,
    emailToCode,
} from './auth.js';
import { loadLocalHistory } from './history.js';
import './wiring.js';

// ============================================================
// Phase A — runs unconditionally, before any auth.
// ============================================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

const _appVersionEl = document.getElementById('appVersion');
if (_appVersionEl) _appVersionEl.textContent = 'v' + APP_VERSION;

['gesturestart', 'gesturechange', 'gestureend'].forEach(evt =>
    document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

initGA4();
initTheme();
const _savedLang = (() => { try { return localStorage.getItem('csa_lang'); } catch { return null; } })();
changeLanguage(_savedLang && translations[_savedLang] ? _savedLang : 'th');

// Flush pending debounced saves before hide/unload (independent of auth).
window.addEventListener('pagehide', _flushHeavyUpdate);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushHeavyUpdate();
});

// ============================================================
// Login overlay helpers
// ============================================================
const loginOverlay   = document.getElementById('loginOverlay');
const loginForm      = document.getElementById('loginForm');
const loginCode      = document.getElementById('loginCode');
const loginError     = document.getElementById('loginError');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');

function showLoginOverlay() {
    if (!loginOverlay) return;
    loginOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (loginError) loginError.textContent = '';
    // Do NOT auto-focus loginCode — that would pop the OS keyboard on mobile.
    // The field carries inputmode="none" + data-numpad so tapping it opens the
    // in-app numpad (same UX as every other numeric field in the app).
}
function hideLoginOverlay() {
    if (!loginOverlay) return;
    loginOverlay.style.display = 'none';
    document.body.style.overflow = '';
}

// ============================================================
// Phase C — bring the app up for a signed-in (or Firebase-disabled) user.
// ============================================================
let _appStarted = false;
function runAppInit() {
    restoreFormState();
    restoreStopwatchState();
    _bumpSessionCount();
    drainFeedbackQueue();
    showOnboardingIfNeeded();
    updateTutProgressBadge();
    calculateAll();
    _flushHeavyUpdate();
    if (document.readyState === 'complete') loadWebFonts();
    else window.addEventListener('load', loadWebFonts);
}

async function enterApp(user) {
    if (_appStarted) return;      // guard: only the first sign-in boots the app
    _appStarted = true;
    if (user) {
        try {
            await subscribeHistory(user.uid);               // await first snapshot
            await migrateLocalHistory(user.uid, loadLocalHistory());
        } catch (_) { /* proceed with whatever cache exists */ }
        // Reveal the account row in Settings and show the employee code
        // (strip the synthetic @ie-calc.internal suffix — operators recognize
        // the code, not the fake email).
        const accountSection = document.getElementById('accountSection');
        const accountEmail   = document.getElementById('accountEmail');
        if (accountEmail) accountEmail.textContent = emailToCode(user.email);
        if (accountSection) accountSection.style.display = '';
    }
    hideLoginOverlay();
    runAppInit();
}

// ============================================================
// Phase B — auth gate.
// ============================================================
async function boot() {
    if (!FIREBASE_ENABLED) {
        // No backend configured → Phase 1 behaviour, no login gate.
        hideLoginOverlay();
        enterApp(null);
        return;
    }
    initFirebase();
    let _sawUser = false;
    onAuthChange(user => {
        _setCurrentUser(user);
        if (user) {
            _sawUser = true;
            enterApp(user);
        } else if (_sawUser) {
            // Signed out mid-session — hard reload so no per-user cache lingers.
            window.location.reload();
        } else {
            // No stored session — show the login gate.
            showLoginOverlay();
        }
    });
}
boot();

// ============================================================
// Login form submit
// ============================================================
loginForm?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!loginCode) return;
    const code = loginCode.value.trim();
    if (!code) return;

    if (loginError) loginError.textContent = '';
    if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.dataset.loading = '1';
        loginSubmitBtn.textContent = t('login_signing_in');
    }
    try {
        await signInWithCode(code);
        // onAuthChange → enterApp handles the transition + overlay hide.
    } catch (err) {
        if (loginError) loginError.textContent = t(authErrorKey(err));
    } finally {
        if (loginSubmitBtn) {
            loginSubmitBtn.disabled = false;
            delete loginSubmitBtn.dataset.loading;
            loginSubmitBtn.textContent = t('login_signin_btn');
        }
    }
});

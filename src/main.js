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
    FLAG_SVG,
} from './app.js';
import { t, currentLang } from './state.js';
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
const loginOverlay      = document.getElementById('loginOverlay');
const loginForm         = document.getElementById('loginForm');
const loginCode         = document.getElementById('loginCode');
const loginCodeToggle   = document.getElementById('loginCodeToggle');
const loginError        = document.getElementById('loginError');
const loginSubmitBtn    = document.getElementById('loginSubmitBtn');

function showLoginOverlay() {
    if (!loginOverlay) return;
    loginOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (loginError) loginError.textContent = '';
}

// Eye-icon toggle for the employee-code field. Starts as type="password"
// (masked bullets); pressing the eye reveals the digits as plain text.
loginCodeToggle?.addEventListener('click', () => {
    if (!loginCode) return;
    const reveal = loginCode.type === 'password';
    loginCode.type = reveal ? 'text' : 'password';
    loginCodeToggle.setAttribute('aria-pressed', reveal ? 'true' : 'false');
});

// ---- Language switcher on the login card ----
// The main header is hidden behind the overlay; operators need a way to change
// language before signing in, so we render a compact 4-flag row at the top-right
// of the card. Uses FLAG_SVG from app.js so it stays in sync with LANG_META.
const loginLang = document.getElementById('loginLang');
function renderLoginLang() {
    if (!loginLang) return;
    const codes = ['th', 'en', 'vn', 'la'];
    loginLang.innerHTML = codes.map(c => `
        <button type="button" class="login-lang-btn ${c === currentLang ? 'active' : ''}"
                data-lang="${c}" aria-label="${c.toUpperCase()}"
                aria-pressed="${c === currentLang}">
            ${FLAG_SVG[c]}
        </button>`).join('');
}
renderLoginLang();
loginLang?.addEventListener('click', e => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    changeLanguage(btn.dataset.lang);
    renderLoginLang();
});
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
        // Reveal the account row in Settings and the header sign-out entry.
        // Show the employee code (strip the synthetic @ie-calc.internal suffix —
        // operators recognize the code, not the fake email).
        const accountSection = document.getElementById('accountSection');
        const accountEmail   = document.getElementById('accountEmail');
        const menuSignout    = document.getElementById('menuSignoutItem');
        if (accountEmail) accountEmail.textContent = emailToCode(user.email);
        if (accountSection) accountSection.style.display = '';
        if (menuSignout)    menuSignout.style.display  = '';
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

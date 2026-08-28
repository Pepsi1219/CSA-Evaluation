// Copyright (c) 2025 Pongsathon. All rights reserved.
// Proprietary — see LICENSE. Do not copy, redistribute, or reverse engineer.
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
    initGA4, initTheme, restoreFormState, restoreStopwatchState, restoreIEState,
    _bumpSessionCount, drainFeedbackQueue, showOnboardingIfNeeded,
    changeLanguage, calculateAll, _flushHeavyUpdate, loadWebFonts,
    FLAG_SVG,
} from './app.js';
import { t, currentLang } from './state.js';
import { updateTutProgressBadge } from './tutorial.js';
import {
    FIREBASE_ENABLED, initFirebase, onAuthChange, subscribeHistory,
    subscribeTutorial, reconcileTutorial,
    migrateLocalHistory, _setCurrentUser, signInWithCode, authErrorKey,
    emailToCode, hasCachedUserMarker, setCachedUserMarker,
    clearCachedUserMarker,
} from './auth.js';
import { loadLocalHistory } from './history.js';
import { loadLocalTutProgress } from './tutorial.js';
import './wiring.js';

// ============================================================
// Phase A — runs unconditionally, before any auth.
// ============================================================
// Only register the SW in production builds. In `npm run dev` a leftover SW
// from an earlier prod visit (or a previous localhost session) would intercept
// requests and serve stale HTML/JS — this manifests as "why does localhost show
// an old version". Unregister anything that's already there when we're in dev,
// so refreshing localhost always shows the current source.
if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
    } else {
        navigator.serviceWorker.getRegistrations().then(rs => {
            rs.forEach(r => r.unregister());
        }).catch(() => {});
    }
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

// Toggle body class so CSS reveals the login card + hides the app container.
// The inline sync script in index.html already stamps `boot-login`/`boot-app`
// from the cached-user marker at HTML-parse time, so first paint is already
// correct — these helpers only run when auth resolution changes the truth
// (marker was stale, or a fresh login just succeeded).
function showLoginOverlay() {
    if (!loginOverlay) return;
    document.body.classList.remove('boot-app');
    document.body.classList.add('boot-login');
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
    document.body.classList.remove('boot-login');
    document.body.classList.add('boot-app');
    document.body.style.overflow = '';
}

// ============================================================
// Phase C — bring the app up for a signed-in (or Firebase-disabled) user.
// ============================================================
let _appStarted = false;
function runAppInit() {
    restoreFormState();
    restoreStopwatchState();
    restoreIEState();
    _bumpSessionCount();
    drainFeedbackQueue();
    showOnboardingIfNeeded();
    updateTutProgressBadge();
    calculateAll();
    _flushHeavyUpdate();
    if (document.readyState === 'complete') loadWebFonts();
    else window.addEventListener('load', loadWebFonts);
}

let _cloudAttached = false;

// Reveal + init the app UI. No cloud sync — that's attachCloudSync's job,
// called separately once Firebase auth resolves. Splitting these two lets
// us optimistically run app init BEFORE Firebase finishes cold-loading
// (cached-user marker path), so the user sees usable UI at first paint.
function enterAppOptimistic() {
    if (_appStarted) return;
    _appStarted = true;
    hideLoginOverlay();
    runAppInit();
}

// Attach Firebase cloud sync + reveal account UI. Called once auth resolves
// to a real user — either directly after enterAppOptimistic() (cached-user
// case) or from enterApp() (fresh sign-in / stale-marker recovery).
function attachCloudSync(user) {
    if (_cloudAttached || !user) return;
    _cloudAttached = true;
    setCachedUserMarker();
    // Belt-and-braces: if the boot timeout (or any earlier code path) put the
    // login card back up while Firebase was still resolving, kill it now.
    // Auth resolved to a real user → the card must not be visible.
    hideLoginOverlay();
    // Kick off cloud sync in the background. Awaiting the first snapshots
    // used to add 300–800 ms to the mobile cold-start; the app doesn't
    // need history/tutorial data to render — both consumers (Settings
    // launcher badge, history modal) use the subscribe*Change callbacks
    // to re-render whenever the cache updates, so a lazy fill is fine.
    // Reconcile runs on the first-snapshot resolve so it merges against
    // real cloud state, not an empty cache.
    subscribeHistory(user.uid)
        .then(() => migrateLocalHistory(user.uid, loadLocalHistory()))
        .catch(() => {});
    subscribeTutorial(user.uid)
        .then(() => reconcileTutorial(user.uid, loadLocalTutProgress()))
        .catch(() => {});
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

function enterApp(user) {
    enterAppOptimistic();
    if (user) attachCloudSync(user);
}

// ============================================================
// Phase B — auth gate.
// ============================================================
async function boot() {
    if (!FIREBASE_ENABLED) {
        // No backend configured → Phase 1 behaviour, no login gate.
        enterApp(null);
        return;
    }
    // Optimistic reveal based on the cached-user marker (set on successful
    // sign-in, cleared on sign-out). Runs BEFORE Firebase's SDK finishes
    // cold-loading (~2–5 s on cheap phones) so the user sees usable UI at
    // first paint instead of a spinner. The inline sync script in
    // index.html already stamped the matching body class for CSS; here we
    // wire up the JS-side state (run app init, or reveal the login form).
    if (hasCachedUserMarker()) enterAppOptimistic();
    else showLoginOverlay();

    initFirebase();
    // Safety: if Firebase never fires onAuthChange (network dies before init
    // resolves) AND we didn't optimistically reveal the app (no cached marker),
    // fall back to the login card so there's an escape hatch. If the optimistic
    // path already revealed the app for a cached user, DO NOT clobber it — on
    // cheap shop-floor phones + factory Wi-Fi, Firebase Auth SDK cold-load
    // routinely takes 4–10 s to restore the IndexedDB session, and stamping
    // boot-login here would hide the app and force a spurious re-login.
    // 12 s is generous enough that a real dead-network case still resolves
    // eventually, without racing a slow-but-alive network.
    const _bootTimeout = setTimeout(() => {
        if (!_cloudAttached && !_appStarted) showLoginOverlay();
    }, 12000);
    onAuthChange(user => {
        _setCurrentUser(user);
        clearTimeout(_bootTimeout);
        if (user) {
            // Attach cloud sync. If the optimistic path already revealed the
            // app, this just wires the account UI + subscriptions on top; if
            // we were showing the login card (marker was wiped but session
            // survived in Firebase's IDB cache), enterApp() reveals the app.
            if (_appStarted) attachCloudSync(user);
            else enterApp(user);
        } else if (_appStarted || _cloudAttached) {
            // Signed out mid-session OR optimistic reveal was wrong (marker
            // was stale, session actually gone). Hard reload so we start
            // fresh at the login card with no per-user cache lingering.
            clearCachedUserMarker();
            window.location.reload();
        } else {
            // No stored session — show the login gate. Clear any stale marker
            // so the next cold boot's optimistic path picks the right UI.
            clearCachedUserMarker();
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

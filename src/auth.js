// Copyright (c) 2025 Pongsathon. All rights reserved.
// Proprietary — see LICENSE. Do not copy, redistribute, or reverse engineer.
// ============================================================
// AUTH — Firebase Auth (email+password) + per-user Firestore history.
//
// This is the backend the Phase 1 history.js "seam" swaps to. history.js
// calls the pure localStorage path when FIREBASE_ENABLED is false or no
// user is signed in; otherwise it reads getHistoryCache() (kept fresh by
// an onSnapshot listener) and routes writes through fsSaveEntry /
// fsDeleteEntry / fsSetNote.
//
// Firebase apiKey is NOT a secret (it always ships to the client). Data is
// protected by Firestore Security Rules (firestore.rules) + Authorized
// domains + Google Cloud API-key restrictions — never by hiding config.
// ============================================================
import { initializeApp } from 'firebase/app';
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'firebase/auth';
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { HISTORY_MAX } from './state.js';

// ---- Config (from Vite env; NOT secrets) ----
// `import.meta.env` exists under Vite; guard so this module also imports cleanly
// under Node (unit tests import mergeHistorySnapshot without a bundler).
const _env = import.meta.env ?? {};
const firebaseConfig = {
    apiKey:            _env.VITE_FIREBASE_API_KEY,
    authDomain:        _env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         _env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     _env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: _env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             _env.VITE_FIREBASE_APP_ID,
};

// Feature flag: only enable the backend when a real config is present.
// Missing env (e.g. a dev checkout without .env) → app runs in the Phase 1
// localStorage-only mode, no login gate. Keeps the app usable offline of Firebase.
export const FIREBASE_ENABLED = !!firebaseConfig.apiKey;

let _app = null, _auth = null, _db = null;
let _currentUser = null;
let _historyCache = [];
let _unsubSnapshot = null;
const _changeHandlers = new Set();

// Tutorial-progress cache (single doc, not a list) + its own change fanout.
// Kept separate from history so subscribing/writing one doesn't touch the
// other; also lets tests import the pure merge helper without pulling any
// history state through.
let _tutorialCache = { done: {}, quiz: null, cert: null };
let _tutorialKnown = { done: {}, quiz: null, cert: null };
let _unsubTutorial = null;
const _tutorialChangeHandlers = new Set();

function stableJson(value) {
    const stable = item => {
        if (Array.isArray(item)) return item.map(stable);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]));
        }
        return item;
    };
    return JSON.stringify(stable(value));
}

// ---- Pure: merge two tutorial-progress objects. Used at first-sign-in
// reconciliation (local ⨯ cloud) and any later cross-device reconciliation.
// Rules: `done` is a union — once done, always done. `quiz` keeps a passing
// result, then the higher `best` score (`pct` for legacy records). `cert`
// keeps whichever exists; if both, the earlier `at` (`ts` for legacy) wins
// (the first certificate issued is the canonical one — reprinting later
// mustn't reset the id or date). Exported for unit testing.
export function mergeTutorialProgress(a, b) {
    a = a && typeof a === 'object' ? a : {};
    b = b && typeof b === 'object' ? b : {};
    const done = {};
    // Completion is monotonic, including when a stale snapshot says false.
    for (const k of new Set([...Object.keys(a.done || {}), ...Object.keys(b.done || {})])) {
        if (a.done?.[k] || b.done?.[k]) done[k] = true;
    }

    let quiz = null;
    const aq = a.quiz, bq = b.quiz;
    if (aq && bq) {
        // Prefer passed over not-passed; if both same pass state, higher pct wins.
        if (aq.passed !== bq.passed) quiz = aq.passed ? aq : bq;
        else {
            const aScore = aq.best ?? aq.pct ?? 0;
            const bScore = bq.best ?? bq.pct ?? 0;
            quiz = aScore !== bScore ? (aScore > bScore ? aq : bq)
                : (aq.at ?? Infinity) !== (bq.at ?? Infinity)
                    ? ((aq.at ?? Infinity) < (bq.at ?? Infinity) ? aq : bq)
                    : (stableJson(aq) <= stableJson(bq) ? aq : bq);
        }
    } else quiz = aq || bq || null;

    let cert = null;
    if (a.cert && b.cert) {
        const aTime = a.cert.at ?? a.cert.ts ?? Infinity;
        const bTime = b.cert.at ?? b.cert.ts ?? Infinity;
        cert = aTime !== bTime ? (aTime < bTime ? a.cert : b.cert)
            : (String(a.cert.id ?? '') <= String(b.cert.id ?? '') ? a.cert : b.cert);
    } else cert = a.cert || b.cert || null;

    return { done, quiz, cert };
}

function sameTutorialProgress(a, b) {
    return stableJson(a) === stableJson(b);
}

// ---- Pure: normalize a raw list of entries into the canonical cache shape.
// Dedupe by id (last write wins), sort by ts descending, cap at HISTORY_MAX.
// Exported for unit testing (test/history-cache.test.js) — no Firebase here.
export function mergeHistorySnapshot(entries) {
    const byId = new Map();
    for (const e of entries) {
        if (e && typeof e.id === 'string' && e.id && !e.id.includes('/')) byId.set(e.id, e);
    }
    const list = [...byId.values()];
    list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    return list;
}

// The old unscoped localStorage keys may contain another operator's data on a
// shared phone. Claim each legacy key for the first account that imports it;
// existing per-uid migration flags identify data already used by older builds.
export function claimLegacyOwner(storage, uid, kind) {
    const flagPrefix = kind === 'history' ? 'csa_migrated_'
        : kind === 'tutorial' ? 'csa_tut_reconciled_' : null;
    if (!flagPrefix || !uid) return false;
    const ownerKey = `csa_${kind}_legacy_owner`;
    const owner = storage.getItem(ownerKey);
    if (owner) return owner === uid;
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(flagPrefix) && key !== flagPrefix + uid) return false;
    }
    storage.setItem(ownerKey, uid);
    return true;
}

const ACCOUNT_STATE_KEYS = ['csa_form_v1', 'csa_stopwatch_v1', 'csa_ie_v1'];
const ACCOUNT_STATE_OWNER = 'csa_account_state_owner';

// The app's form and timers intentionally keep their existing fast local keys.
// Swap those keys at a confirmed account change, before app state is restored.
// An old unowned state is accepted only when a cached login existed at boot;
// otherwise its owner cannot be established safely on a shared phone.
export function prepareAccountLocalState(storage, uid, allowLegacy = false) {
    if (!uid) return false;
    const owner = storage.getItem(ACCOUNT_STATE_OWNER);
    if (owner === uid) return false;
    for (const key of ACCOUNT_STATE_KEYS) {
        const current = storage.getItem(key);
        if (owner && current !== null) storage.setItem(`${key}_${owner}`, current);
        if (!owner && !allowLegacy && current !== null) {
            const unclaimed = `${key}_legacy_unclaimed`;
            if (storage.getItem(unclaimed) === null) storage.setItem(unclaimed, current);
        }
        if (owner || !allowLegacy) {
            const next = storage.getItem(`${key}_${uid}`);
            if (next === null) storage.removeItem(key);
            else storage.setItem(key, next);
        }
    }
    storage.setItem(ACCOUNT_STATE_OWNER, uid);
    return !!owner && owner !== uid;
}

// ---- Init. Idempotent; safe to await more than once. ----
export function initFirebase() {
    if (!FIREBASE_ENABLED || _app) return _app;
    _app  = initializeApp(firebaseConfig);
    _auth = getAuth(_app);
    // Modern offline persistence (enableIndexedDbPersistence is deprecated in
    // the v10+ SDK). Multi-tab manager so two open tabs share one cache.
    _db = initializeFirestore(_app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    return _app;
}

// ---- Auth ----
export function onAuthChange(cb) {
    if (!_auth) return () => {};
    return onAuthStateChanged(_auth, cb);
}

export async function signIn(email, password) {
    if (!_auth) throw new Error('auth-not-ready');
    const cred = await signInWithEmailAndPassword(_auth, email.trim(), password);
    return cred.user;
}

// Employee-code login. The app UI collects a numeric code (e.g. 68020002),
// which is synthesized into a Firebase email+password pair here. The suffix
// domain is a placeholder — no mail is ever sent, Firebase only checks format.
// The "password" is the code itself; effective security is the pre-registered
// allowlist in Firebase Auth (unknown code → auth error) + Firestore Rules
// (each uid can only touch its own history). Keep employee codes hard to guess
// (avoid strictly sequential numbering).
export const EMPLOYEE_EMAIL_SUFFIX = '@ie-calc.internal';
export function codeToEmail(code) { return `${String(code).trim()}${EMPLOYEE_EMAIL_SUFFIX}`; }
export function emailToCode(email) {
    if (!email) return '';
    const at = email.indexOf('@');
    return at >= 0 ? email.slice(0, at) : email;
}
export async function signInWithCode(code) {
    const c = String(code).trim();
    if (!c) throw Object.assign(new Error('empty-code'), { code: 'auth/invalid-credential' });
    return signIn(codeToEmail(c), c);
}

export async function signOutUser() {
    if (!_auth) return;
    clearCachedUserMarker();
    await signOut(_auth);
}

// ---- Cached-user marker ----
// Sync hint written to localStorage after auth resolves to a real user, cleared
// on sign-out. Read at boot to decide whether to reveal the login card
// immediately (marker absent → user almost certainly signed out; don't make
// them wait for Firebase's SDK to load) or keep the splash briefly (marker
// present → we expect onAuthChange to hand back a user and swap in the app).
// Marker can go stale (signed out on another device, cache wiped, etc.); the
// boot flow handles that by revealing the login card when onAuthChange
// eventually reports null.
const CACHED_USER_KEY = 'csa_seen_user';
const CACHED_USER_UID_KEY = 'csa_seen_uid';
export function hasCachedUserMarker() {
    try { return localStorage.getItem(CACHED_USER_KEY) === '1'; } catch { return false; }
}
export function getCachedUserUid() {
    try { return localStorage.getItem(CACHED_USER_UID_KEY); } catch { return null; }
}
export function setCachedUserMarker(uid) {
    try {
        localStorage.setItem(CACHED_USER_KEY, '1');
        if (uid) localStorage.setItem(CACHED_USER_UID_KEY, uid);
    } catch {}
}
export function clearCachedUserMarker() {
    try {
        localStorage.removeItem(CACHED_USER_KEY);
        localStorage.removeItem(CACHED_USER_UID_KEY);
    } catch {}
}

export function getCurrentUser() { return _currentUser; }
export function isSignedIn() { return FIREBASE_ENABLED && !!_currentUser; }

// Map a Firebase auth error code to one of our translation keys.
export function authErrorKey(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
        code === 'auth/user-not-found' || code === 'auth/invalid-email') return 'login_err_invalid';
    if (code === 'auth/too-many-requests') return 'login_err_toomany';
    if (code === 'auth/network-request-failed') return 'login_err_network';
    return 'login_err_generic';
}

// ---- Firestore per-user history ----
function _historyCol(uid) { return collection(_db, 'users', uid, 'history'); }

// Subscribe to the signed-in user's history. Populates the in-memory cache and
// notifies change handlers on every snapshot. Returns a promise that resolves
// once the FIRST snapshot has arrived (so enterApp can await initial data).
export function subscribeHistory(uid) {
    if (_unsubSnapshot) { _unsubSnapshot(); _unsubSnapshot = null; }
    return new Promise(resolve => {
        let resolved = false;
        _unsubSnapshot = onSnapshot(_historyCol(uid),
            snap => {
                const entries = snap.docs.map(d => d.data());
                _historyCache = mergeHistorySnapshot(entries);
                _changeHandlers.forEach(fn => { try { fn(); } catch (_) {} });
                if (!resolved) { resolved = true; resolve(); }
            },
            _err => {
                // Permission / network error — keep whatever cache we have and
                // let the app proceed rather than hang on the first-snapshot await.
                if (!resolved) { resolved = true; resolve(); }
            }
        );
    });
}

export function getHistoryCache() { return _historyCache; }

// Register a callback fired after every snapshot (history.js re-renders the
// open modal). Returns an unsubscribe fn.
export function subscribeHistoryChange(cb) {
    _changeHandlers.add(cb);
    return () => _changeHandlers.delete(cb);
}

// Write ops — fire-and-forget from the caller's view; the onSnapshot listener
// updates the cache + triggers re-render. Offline writes are queued by the
// Firestore SDK's local cache and synced on reconnect.
export function fsSaveEntry(entry) {
    if (!isSignedIn()) return Promise.resolve();
    return setDoc(doc(_db, 'users', _currentUser.uid, 'history', entry.id), entry);
}
export function fsDeleteEntry(id) {
    if (!isSignedIn()) return Promise.resolve();
    return deleteDoc(doc(_db, 'users', _currentUser.uid, 'history', id));
}
export function fsSetNote(id, note) {
    if (!isSignedIn()) return Promise.resolve();
    return updateDoc(doc(_db, 'users', _currentUser.uid, 'history', id), { note });
}

// ---- Tutorial progress (single doc at users/{uid}/tutorial/state) ----
function _tutorialDoc(uid) { return doc(_db, 'users', uid, 'tutorial', 'state'); }

// Subscribe to the signed-in user's tutorial progress. Populates the
// in-memory cache and fires change handlers on each snapshot. Returns a
// promise that resolves once the FIRST snapshot has arrived so enterApp
// can reconcile with the local copy before rendering.
export function subscribeTutorial(uid) {
    if (_unsubTutorial) { _unsubTutorial(); _unsubTutorial = null; }
    _tutorialKnown = { done: {}, quiz: null, cert: null };
    return new Promise(resolve => {
        let resolved = false;
        _unsubTutorial = onSnapshot(_tutorialDoc(uid),
            snap => {
                const raw = snap.exists() ? snap.data() : null;
                const cloud = raw && typeof raw === 'object'
                    ? { done: raw.done || {}, quiz: raw.quiz || null, cert: raw.cert || null }
                    : { done: {}, quiz: null, cert: null };
                _tutorialKnown = mergeTutorialProgress(_tutorialKnown, cloud);
                _tutorialCache = _tutorialKnown;
                _tutorialChangeHandlers.forEach(fn => { try { fn(); } catch (_) {} });
                // A stale whole-document write from another device can erase
                // progress we already saw. Restore the union in the background.
                if (!sameTutorialProgress(cloud, _tutorialKnown)) {
                    setDoc(_tutorialDoc(uid), _tutorialKnown).catch(() => {});
                }
                if (!resolved) { resolved = true; resolve(); }
            },
            _err => { if (!resolved) { resolved = true; resolve(); } }
        );
    });
}

export function getTutorialCache() { return _tutorialCache; }

// Callback fired after every snapshot (tutorial.js re-renders the open
// tutorial view + updates the Settings launcher badge). Returns unsubscribe.
export function subscribeTutorialChange(cb) {
    _tutorialChangeHandlers.add(cb);
    return () => _tutorialChangeHandlers.delete(cb);
}

// Write the full progress doc. The snapshot listener merges any stale remote
// write with progress already seen during this session and repairs it.
export function fsSaveTutorial(state) {
    if (!isSignedIn()) return Promise.resolve();
    // Never persist undefined/null shape — coerce to the empty defaults.
    const safe = mergeTutorialProgress(_tutorialKnown, {
        done: state?.done || {},
        quiz: state?.quiz || null,
        cert: state?.cert || null,
    });
    _tutorialKnown = safe;
    return setDoc(_tutorialDoc(_currentUser.uid), safe);
}

// Reconcile this account's local backup on every sign-in. The old unscoped
// local key is imported only once, by its original owner where identifiable.
export async function reconcileTutorial(uid, localProgress, accountProgress) {
    const flag = `csa_tut_reconciled_${uid}`;
    let importLegacy = false;
    try {
        importLegacy = !localStorage.getItem(flag)
            && claimLegacyOwner(localStorage, uid, 'tutorial');
    } catch (_) { /* Cloud progress and account-local backup still work. */ }
    let merged = mergeTutorialProgress(_tutorialCache, accountProgress);
    if (importLegacy) merged = mergeTutorialProgress(merged, localProgress);
    _tutorialKnown = mergeTutorialProgress(_tutorialKnown, merged);
    // Only write if the merge would actually change what's on the cloud —
    // avoids a wasted round-trip on every fresh sign-in where local is empty.
    const same = sameTutorialProgress(merged, _tutorialCache);
    if (!same) {
        _tutorialCache = _tutorialKnown;
        _tutorialChangeHandlers.forEach(fn => { try { fn(); } catch (_) {} });
    }
    if (!same) await setDoc(_tutorialDoc(uid), merged);
    if (importLegacy) {
        try { localStorage.setItem(flag, '1'); } catch (_) {}
    }
}

// ---- One-time migration: copy this device's localStorage history into the
// user's Firestore collection on first sign-in for that uid. Idempotent via a
// per-uid flag; never deletes the localStorage copy. ----
export async function migrateLocalHistory(uid, localEntries) {
    const flag = `csa_migrated_${uid}`;
    try {
        if (localStorage.getItem(flag) || !claimLegacyOwner(localStorage, uid, 'history')) return;
    } catch (_) { return; }
    if (Array.isArray(localEntries) && localEntries.length) {
        const batch = writeBatch(_db);
        for (const e of localEntries) {
            if (e && e.id != null) batch.set(doc(_db, 'users', uid, 'history', e.id), e);
        }
        await batch.commit();
    }
    try { localStorage.setItem(flag, '1'); } catch (_) {}
}

// Called by main.js from the auth-state callback so the rest of the module
// knows who's signed in without re-reading auth.currentUser everywhere.
export function _setCurrentUser(user) { _currentUser = user; }

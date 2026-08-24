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

// ---- Pure: normalize a raw list of entries into the canonical cache shape.
// Dedupe by id (last write wins), sort by ts descending, cap at HISTORY_MAX.
// Exported for unit testing (test/history-cache.test.js) — no Firebase here.
export function mergeHistorySnapshot(entries) {
    const byId = new Map();
    for (const e of entries) {
        if (e && e.id != null) byId.set(e.id, e);
    }
    const list = [...byId.values()];
    list.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    return list;
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
    await signOut(_auth);
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

// ---- One-time migration: copy this device's localStorage history into the
// user's Firestore collection on first sign-in for that uid. Idempotent via a
// per-uid flag; never deletes the localStorage copy. ----
export async function migrateLocalHistory(uid, localEntries) {
    const flag = `csa_migrated_${uid}`;
    try { if (localStorage.getItem(flag)) return; } catch (_) { return; }
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

# แผนงานลงมือ (Execution Checklist)

เอกสารนี้คือ **checklist การทำงานจริง** ที่แตกจาก [plan-backend-firebase.md](./plan-backend-firebase.md) — เอกสารนั้นบอก "ทำอะไร/ทำไม" ส่วนไฟล์นี้บอก "step-by-step และเช็คเมื่อทำเสร็จ" กันลืม/กันข้ามขั้นตอน

**หลัก:** commit เป็นก้อนย่อย ผ่านเช็คพอยต์เขียวทุกก้อน • ทุก sub-commit ต้อง `npm test` ผ่าน • ห้าม `git push` โดยไม่ได้รับคำสั่งชัด (deploy จริงกับผู้ใช้จริง)

**Branch strategy:** ทำบน branch แยก `phase-1-vite-esm` → merge เข้า `main` เมื่อจบ Phase 1 ทั้งก้อน • Phase 2/3/4 branch แยกแต่ละเฟส

---

## Pre-flight (ตัดสินก่อนเริ่ม)

- [x] เลือก branch strategy: แยก `phase-1-vite-esm` (แนะนำ) หรือทำบน main
- [x] ยืนยันวิธีจัดการ shared state ระหว่าง app.js ↔ chart.js/tutorial.js: (ก) สร้าง `src/state.js` กลาง หรือ (ข) pass ผ่าน parameter/callback
- [x] ยืนยันวิธีผูก `calculateAll` กับ input ~15 ช่อง: (ก) delegation ที่ container root หรือ (ข) วน `FORM_FIELD_IDS` ใส่ทีละ listener (แนะนำ ข)
- [x] สร้าง branch `phase-1-vite-esm`

---

## Phase 1a — Toolchain + tests เป็น ESM (แอปยังรันเก่า)

**เป้าหมาย:** Vite ติดตั้งได้ • tests เขียว • แอปเดิมยังใช้งานได้ผ่าน `python3 -m http.server` เหมือนเดิม

- [x] `npm i -D vite vite-plugin-pwa vite-plugin-javascript-obfuscator`
- [x] เพิ่ม `"type": "module"` ใน `package.json`
- [x] เพิ่ม scripts: `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"` (คง `"test": "node --test"`)
- [x] สร้าง `vite.config.js` ขั้นต่ำ (root=`.`, ยังไม่ใส่ obfuscator/PWA) — เอาไว้ให้ dev/build สั่งได้
- [x] แปลง `test/calc.test.js` → `import { parseNum, ... } from '../calc.js'` (calc.js ยังคง `module.exports` ได้ชั่วคราวโดยเพิ่ม `export` คู่กันไม่ต้อง)
- [x] แปลง `test/timeutil.test.js` เหมือนกัน
- [x] แปลง `test/translations.test.js`
- [x] แปลง `test/tutorial.test.js`
- [x] แปลง `test/version.test.js` — ระวัง `__dirname` ไม่มีใน ESM (ใช้ `fileURLToPath(import.meta.url)`)
- [x] เพิ่ม `export { ... }` คู่กับ `module.exports` ในทุก pure module ชั่วคราว (dual mode) เพื่อให้ tests ผ่านโดยไม่แตะ browser loading
- [x] `npm test` เขียวทั้งหมด (96+ tests)
- [x] เปิด `python3 -m http.server` แล้วยืนยันแอปเดิมทำงาน (spot-check: calc, stopwatch, tutorial, history)
- [x] **commit:** `chore: add Vite toolchain + migrate tests to ESM (dual mode)`

## Phase 1b — src/ + แปลง pure modules เป็น ESM แท้ + main.js

**เป้าหมาย:** ทุกไฟล์ JS อยู่ใน `src/` เป็น ESM แท้ • index.html โหลด `<script type="module" src="/src/main.js">` เดียว • ทุกฟีเจอร์ยังทำงานผ่าน `npm run dev`

- [x] `mkdir src`
- [x] `git mv version.js calc.js timeutil.js translations.js chart.js history.js tutorial.js src/`
- [x] `git mv script.js src/app.js`
- [x] สร้าง `src/main.js` (entry) — ยกเนื้อหา init block ท้าย `src/app.js` (~30 บรรทัดสุดท้าย: `initGA4/initTheme/restoreFormState/...calculateAll/loadWebFonts` + `pagehide/visibilitychange`) มาที่นี่
- [x] ตัด init block เดิมออกจาก `src/app.js`
- [x] ตัดสินเรื่อง shared state (จาก pre-flight) → ถ้าเลือก `src/state.js` ให้สร้างและย้าย `currentLang`, `pcsPerHr` (+ `_chartCache`) ไปไว้ในนั้น
- [x] **แปลง `src/version.js`:** `export const APP_VERSION`; ลบ `if (module.exports)`; คง `if (typeof self !== 'undefined') self.APP_VERSION = APP_VERSION` ไว้เพื่อ SW context อ่านได้ (SW ยังเป็น script เก่าจน Phase 4)
- [x] **แปลง `src/calc.js`:** `export { parseNum, pcsFromEff, ... }`; ลบ dual mode
- [x] **แปลง `src/timeutil.js`:** `export { fmtSw, fmtSec2, ..., csvBuild, T_TABLE, tsTValue, computeSampleSize }`
- [x] **แปลง `src/translations.js`:** `export const translations`; export helper `t`, `changeLanguage` ถ้าย้ายมาที่นี่ (ปัจจุบันอยู่ใน script.js)
- [x] **แปลง `src/chart.js`:** `import { t, currentLang } from './translations.js'` (หรือ state.js); `export { setChartMode, renderChartFromCache, renderSVGChart, _chartCache }`
- [x] **แปลง `src/history.js`:** `import { parseNum } from './calc.js'`; `import { t, currentLang } from './translations.js'`; `import { gaTrack, getSamMinutes } from './app.js'`; `export { STORAGE_KEY_HISTORY, HISTORY_MAX, loadHistory, persistHistory, saveCurrentToHistory, deleteHistoryEntry, setHistoryNote }`
- [x] **แปลง `src/tutorial.js`:** `import { currentLang, gaTrack } from ...`; `export { openTutorial, tutorialOnLangChange, updateTutProgressBadge, ... }`
- [x] **แปลง `src/app.js`:** `import { APP_VERSION } from './version.js'`; `import { parseNum, pcsFromEff, ... } from './calc.js'`; `import { translations } from './translations.js'`; `import { renderChartFromCache, ... } from './chart.js'`; `import { saveCurrentToHistory, loadHistory, ... } from './history.js'`; `import { openTutorial, ... } from './tutorial.js'`; export ทุกฟังก์ชันที่ main.js / wiring.js / handler ต้องเรียก (`calculateAll`, `openStopwatchModal`, `exportCSV`, `printReport`, `openHistoryModal`, `resetForm`, `swSetMode`, `swStartStop`, ... รวมถึงทั้งหมดที่ inline handler เรียกอยู่)
- [x] **แก้ `index.html`:** ลบ 8 `<script defer>` เดิม แทนด้วย `<script type="module" src="/src/main.js"></script>` เดียว
- [x] **stamp footer:** ย้ายโค้ด `document.getElementById('appVersion').textContent = 'v' + APP_VERSION` ไป `src/main.js` (เดิมอยู่ใน script.js top-level)
- [x] อัพเดต `test/version.test.js` — path ไป `../src/version.js` และ read `src/*.js` แทน root
- [x] อัพเดต `test/*.test.js` ทั้งหมด — path ไป `../src/`
- [x] อัพเดต `test/tutorial.test.js` — ถ้าตรวจ screenshot path ให้ยังชี้ `../assets/tutorial/` (ยังไม่ย้ายไป public ในสเต็ปนี้)
- [x] `npm test` เขียว
- [x] `npm run dev` — spot-check ทุกฟีเจอร์: calc, ambient status, formula modal, stopwatch (start/lap/pause/stop/continue/save), Time Study N, numpad, history (save/compare/delete/note), tutorial → quiz → cert, theme toggle, language 4 ภาษา, CSV export, print
- [x] **commit:** `refactor: convert all modules to ESM under src/`

## Phase 1c — inline handlers → data-action + delegation

**เป้าหมาย:** ลบ inline handler ทั้ง 57 จุด • ทุก event ผูกใน `src/wiring.js` • `npm run dev` ยังใช้งานได้ครบเหมือนเดิม

- [x] สร้าง `src/wiring.js` เปล่า และ `import './wiring.js'` ใน `main.js`
- [x] **index.html — header/menu (6 จุด):** `exportCSV`, `printReport`, `openHistoryModal`, `pwaInstall`, `toggleTheme`, `openSettingsModal`, `resetForm` → ใส่ `data-action="csv|print|history|install|theme|settings|reset"` + delegation click
- [x] **index.html — SAM unit toggle (2 จุด):** `setSamUnit('min'|'sec')` → `data-action="sam-unit"` + `data-value`
- [x] **index.html — input recalc (~11 ช่อง):** ลบ `oninput="calculateAll()"` ทั้งหมด — วน `FORM_FIELD_IDS` ใน wiring.js ใส่ listener; **เพิ่ม** `samInput`, `effTargetInput` ที่ไม่อยู่ใน FORM_FIELD_IDS ปัจจุบันด้วย
- [x] **index.html — stopwatch modal (~13 จุด):** `closeStopwatchModal`, `swSetMode`, `openTsConfigModal`, `swLapOrReset`, `swPauseResume`, `swStartStop`, `swToggleStatInfo(...)` (6 ปุ่ม), `swContinueTiming`, `swSaveToForm` → `data-action`
- [x] **index.html — TS config modal (5 จุด):** `closeTsConfigModal`, `tsSetConfidence(90|95|99)`, `tsRecalculate` (input)
- [x] **index.html — onboarding (2 จุด):** `finishOnboarding`, `onboardNext`
- [x] **index.html — settings (1 จุด):** `openTutorial`
- [x] **index.html — stopwatch open (1 จุด):** `openStopwatchModal`
- [x] **chart.js (2 จุด):** `setChartMode('pcs'|'eff')` → `data-action="chart-mode"` + delegation บน chart container
- [x] **tutorial.js (13 จุด):** `tutOpenLesson`, `tutStartQuiz`, `tutOpenCert`, `tutStep`, `tutPick`, `tutQuizNav`, `tutGoHome`, `tutGenerateCert`, `tutDownloadCert` → `data-action` + `data-*` params, delegation บน `#tutorialBody`
- [x] **app.js (1 จุด):** ที่เหลือ (จำนวนน้อย) — น่าจะปุ่มใน history modal
- [x] เช็คว่าไม่มี `on[a-z]+="` ค้างในโค้ด: `grep -rn 'on[a-z]\+="' src/ index.html`
- [x] `npm test` เขียว
- [x] `npm run dev` — spot-check ครบทุกฟีเจอร์อีกรอบ (นี่คือรอบที่เสี่ยงพัง regression มากที่สุด)
- [x] **commit:** `refactor: replace inline handlers with data-action + delegation`

## Phase 1d — public/ + PWA path fix

**เป้าหมาย:** static assets อยู่ใน `public/` ตาม Vite convention • path คงที่ไม่ hash

- [x] `git mv manifest.json public/`
- [x] `git mv icon.svg public/`
- [x] `git mv assets/ public/assets/` (รวม tutorial/en/vn/la)
- [x] `git mv sw.js public/sw.js` (ชั่วคราว ยังใช้ตัวเก่า จน Phase 4 injectManifest)
- [x] แก้ path ใน `index.html` (`manifest.json`, `icon.svg`) — Vite รู้จัก `/manifest.json` โดยตรง
- [x] แก้ `test/tutorial.test.js` — screenshot path → `../public/assets/tutorial/...`
- [x] แก้ `test/version.test.js` — sw path → `../public/sw.js`
- [x] `npm test` เขียว
- [x] `npm run build` สำเร็จ, `dist/` มีไฟล์ครบ
- [x] `npm run preview` — spot-check ครบทุกฟีเจอร์บน production build
- [x] อัพเดต `CLAUDE.md`: เพิ่ม section "Build model" (Vite + ESM), แก้ตัวอย่าง path จาก root เป็น `src/`, ลบ "no build step"
- [x] **commit:** `chore: move static assets to public/ and update CLAUDE.md for build`

## Phase 1 — ทำก่อน merge

- [x] `npm test` เขียวเต็ม
- [x] `npm run build` เขียว
- [ ] `npm run preview` — E2E manual ครบทุกฟีเจอร์ (ผู้ใช้ตรวจ UI/CSS เอง)
- [x] อัพเดต `CLAUDE.md` ให้ตรงกับ src/ layout + build commands + ESM
- [x] Bump `APP_VERSION` → 1.19.0 (structural change), sync `sw.js`, `package.json`, footer
- [ ] Merge `phase-1-vite-esm` → `main` (**รอ user สั่ง push ก่อนเสมอ**)

---

## Phase 2 — Firebase Auth + Firestore

**Branch:** `phase-2-firebase`

- [x] `npm i firebase`
- [x] เพิ่ม `.env.example` ครบ `VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID`
- [x] เพิ่ม `.env` ใน `.gitignore` (ปัจจุบันยังไม่มี)
- [ ] สร้าง Firebase project (ผู้ใช้ทำใน console), enable Email/Password Auth
- [x] **`src/auth.js`:**
  - [x] `initFirebase()` — `initializeApp` + `getAuth` + `initializeFirestore` + `persistentLocalCache` (แทน `enableIndexedDbPersistence` ที่ deprecated ใน SDK v12)
  - [x] `signIn(email, password)` / `signOutUser()` / `onAuthChange(cb)`
  - [x] Firestore data layer: `subscribeHistory(uid, onSnap)` → `onSnapshot('users/{uid}/history')`
  - [x] in-memory cache + `getHistoryCache()`
  - [x] `fsSaveEntry(uid, entry)` / `fsDeleteEntry(uid, id)` / `fsSetNote(uid, id, note)`
  - [x] `mergeHistorySnapshot(entries)` pure — dedupe by id → sort ts desc → cap `HISTORY_MAX`
- [x] **`src/main.js` — 3-phase boot:**
  - [x] Phase A: theme + lang (รันเสมอ, ให้ overlay มีธีมถูก)
  - [x] Phase B: `await initFirebase()` → `onAuthChange` → `showLoginOverlay()` หรือ `enterApp(user)`
  - [ ] sign-out mid-session → `location.reload()`
  - [x] Phase C `enterApp(user)`: `await` first snapshot → migration → hide overlay → เรียก app init (restoreFormState/restoreStopwatchState/... /calculateAll/loadWebFonts)
- [x] **`src/history.js` seam:** `loadHistory()` — ถ้าล็อกอิน & `FIREBASE_ENABLED` → `getHistoryCache()`; write ops branch ไป `fs*`; consumer (`renderHistoryList`, `renderCompareTable`) ไม่แตะ
- [x] **Migration ครั้งแรก/uid:** flag `csa_migrated_<uid>` → `writeBatch` → `setDoc(id=entry.id)` idempotent → commit → ตั้ง flag → **ไม่ลบ** `csa_history_v1`
- [ ] **`index.html`:** เพิ่ม `#loginOverlay` (คัดจาก `#onboardingOverlay`), input email/password เป็น text ปกติ (ห้าม `inputmode="none"`, ห้าม numpad), section บัญชี + ปุ่ม Sign out ใน `#settingsModal`
- [x] wiring.js ผูก login submit + sign-out
- [x] **`src/translations.js` — เพิ่มคีย์ 4 ภาษา:**
  - [x] `login_title` / `login_subtitle`
  - [x] `login_email_label` / `login_email_ph`
  - [x] `login_password_label` / `login_password_ph`
  - [x] `login_signin_btn` / `login_signing_in`
  - [ ] `login_offline_note`
  - [x] `login_err_invalid` / `login_err_toomany` / `login_err_network` / `login_err_generic`
  - [x] `set_account`, `account_signed_in_as` (**คง `{email}` ทุกภาษา**), `account_signout`
- [x] **`firestore.rules`:** เขียนตามแผน (users/{uid}/history เฉพาะ owner)
- [ ] เผยแพร่ rules ผ่าน `firebase deploy --only firestore:rules` (หรือ console)
- [ ] Firebase Console → Authorized domains: เพิ่ม `localhost` (dev)
- [x] **`test/history-cache.test.js`:** ทดสอบ `mergeHistorySnapshot` (dedupe/sort/cap, 7 tests) — migration idempotency ตรวจผ่าน manual E2E (ต้อง mock Firebase ถึงจะ unit test ได้)
- [x] **`test/translations.test.js`** ต้องผ่าน (คีย์ใหม่ครบ 4 ภาษา + `{email}` token คงอยู่)
- [x] `npm test` เขียว, `npm run build` เขียว
- [ ] **Manual E2E** (บน http://localhost, ไม่ใช่ file://):
  - [ ] รหัสผิด → error ตรงภาษา
  - [ ] รหัสถูก → เข้าแอป, snapshot มา, history render
  - [ ] Save entry → เห็น doc ใน `/users/{uid}/history` (Firebase Console)
  - [ ] Reload → เข้าตรง (session ค้าง IndexedDB, ไม่ผ่าน overlay)
  - [ ] Sign out → กลับหน้า login, form/stopwatch state reset
  - [ ] Login user คนที่ 2 → history ว่าง; user #1 ไม่เห็นของ user #2
  - [ ] ยิงจาก Rules Playground ยืนยัน rule reject cross-uid
  - [ ] Reload หลัง migration → ไม่ migrate ซ้ำ (ดู network tab)
  - [ ] Offline (DevTools) → save ได้ (แค่ cache) → กลับ online → sync ขึ้น
- [ ] Bump version 1.20.0
- [ ] **commit + merge:** `feat: gate app with Firebase Auth + per-user Firestore history`

---

## Phase 3 — ปกป้องโค้ด

**Branch:** `phase-3-protect`

- [ ] `vite.config.js`: `build.sourcemap: false`, `build.minify: 'terser'` (หรือ esbuild default)
- [ ] เพิ่ม `vite-plugin-javascript-obfuscator` — จูนความแรง:
  - [ ] `controlFlowFlattening: true` (threshold ~0.75)
  - [ ] `deadCodeInjection: true` (threshold ~0.4)
  - [ ] `stringArray: true` + `stringArrayEncoding: ['base64']` (rc4 หนักไป)
  - [ ] `stringArrayThreshold: 0.75`
  - [ ] `selfDefending: true`
  - [ ] `debugProtection: true` + `debugProtectionInterval: 2000`
  - [ ] `disableConsoleOutput: true` (dev ยังปกติเพราะ obfuscator รันแค่ prod build)
  - [ ] `renameGlobals: false` (safer; DOM listener + Firebase อาศัย global บางตัว)
  - [ ] `include: ['src/**/*.js']`, `exclude: ['node_modules/**']` — ห้าม obfuscate firebase!
- [ ] วัด bundle size ก่อน/หลัง — ถ้าโตเกิน 2× ให้ลดความแรง
- [ ] วัด perf บนมือถือกลาง — chart/tutorial render ต้องยัง smooth
- [ ] ยืนยัน source map ไม่มีใน `dist/` (`ls dist/assets/*.map` → ว่าง)
- [ ] เพิ่ม `LICENSE` แบบสงวนลิขสิทธิ์ (All rights reserved)
- [ ] เพิ่ม copyright header ในไฟล์หลัก (`src/main.js`, `src/app.js`, `src/calc.js`, `src/auth.js`)
- [ ] Firebase Console → API key restrictions: จำกัด HTTP referrers (Vercel domain + localhost dev)
- [ ] **commit:** `build: enable obfuscation + source map disabled + LICENSE`

---

## Phase 4 — Deploy Vercel + PWA/SW

**Branch:** `phase-4-vercel`

- [ ] `vite.config.js`: กำหนด `vite-plugin-pwa` แบบ `injectManifest`, `srcDir: 'src'`, `filename: 'sw.js'`, `strategies: 'injectManifest'`
- [ ] ย้าย `public/sw.js` → `src/sw.js` (source), แก้ให้ปลั๊กอิน inject `self.__WB_MANIFEST` แทนที่ ASSETS list เดิม; รักษา CACHE literal + network-first + 3s timeout + navigation fallback + synthetic 503 เหมือนเดิม
- [ ] อัพเดต `test/version.test.js` — sw source path → `src/sw.js`
- [ ] `npm run build` → ยืนยัน `dist/sw.js` มี `__WB_MANIFEST` แทนที่ + CACHE literal ตรง APP_VERSION
- [ ] `npm run preview` — ทดสอบ offline (DevTools) ผ่านทุก scenario เดิม
- [ ] เพิ่ม `vercel.json` (ถ้าจำเป็น) — Vercel มัก auto-detect Vite
- [ ] Push branch → Vercel deploy preview → ทดสอบบน URL preview
- [ ] Firebase Console → Authorized domains: เพิ่ม `*.vercel.app` + custom domain
- [ ] ตั้ง env vars ใน Vercel dashboard: `VITE_FIREBASE_*` ทุกตัว
- [ ] Deploy production
- [ ] Custom domain (ถ้ามี) — setup DNS
- [ ] อัพเดต `CLAUDE.md`: deploy target → Vercel (ไม่ใช่ GitHub Pages), env vars, sw source location
- [ ] Bump 1.21.0 (final)
- [ ] **commit + merge:** `feat: deploy on Vercel with PWA injectManifest`

---

## เช็คก่อนปิดโปรเจกต์

- [ ] `CLAUDE.md` ตรงกับสถานะจริง 100% (build model, layout, commands, deploy)
- [ ] `docs/plan-backend-firebase.md` ยังคงเป็น strategic doc; `docs/plan.md` (ไฟล์นี้) อัพเดตทุกรอบ commit
- [ ] Firebase Console: rules published, API key restricted, authorized domains ครบ
- [ ] `.env` ไม่โผล่ใน git history (ตรวจ `git log --all -- .env`)
- [ ] ทุกฟีเจอร์ offline: calc, stopwatch, history save (queued sync), tutorial, chart
- [ ] Login user #2 ไม่เห็นข้อมูล user #1 (Rules Playground + manual)

---

## Rollback plan (กรณีอะไรพัง)

- Phase 1 พัง → revert branch, main ยังเป็น no-build (GitHub Pages ปกติ)
- Phase 2 พัง → toggle `FIREBASE_ENABLED = false` ใน main.js → history fallback localStorage เดิม
- Phase 3 พัง (obfuscation หนักไป) → ลด threshold หรือปิด `selfDefending`/`debugProtection`
- Phase 4 พัง → Vercel rollback previous deploy; DNS ชี้กลับ GitHub Pages ชั่วคราว

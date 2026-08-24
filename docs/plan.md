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

### ⚠ Deviations from the original plan (locked in with the user)

- **Login = employee-code only** (ไม่ใช่ email + password) — ผู้ใช้พิมพ์แค่ `68020002`
  แอปสังเคราะห์ email `68020002@ie-calc.internal` + password = รหัสตัวมันเอง
  ยิงเข้า Firebase Auth ตรวจ allowlist ที่ admin สร้างไว้ใน Console
  (security = allowlist + Firestore Rules; รหัสควรตั้งแบบไม่เรียงกันเป๊ะเพื่อกันเดา)
- **Password field:** `type="password"` + ปุ่ม eye toggle · ไม่มี in-app numpad ที่หน้า login
  (`inputmode="numeric"` ให้ OS ปล่อย numeric keyboard แทน)
- **ไม่มี** offline note ที่หน้า login (ผู้ใช้ถอดออก)
- **Language switcher** บนการ์ด login มุมขวาบน (4 ธง) — ผู้ใช้เปลี่ยนภาษาก่อน sign in ได้
- **Sign out** อยู่ทั้งใน Settings และในเมนู header actions
- Numpad ทั้งแอปย่อลงเล็กน้อย (60→48px keys) หลัง user feedback

### Code tasks — ✅ ทำเสร็จหมด

- [x] `npm i firebase`
- [x] `.env.example` + `.env` gitignored (VITE_FIREBASE_* ครบ, .env มีค่าจริงแล้ว)
- [x] **`src/auth.js`:** initFirebase (persistentLocalCache — modern replacement ของ deprecated enableIndexedDbPersistence), signIn/signOutUser/onAuthChange, subscribeHistory (onSnapshot), in-memory cache + getHistoryCache, fsSaveEntry/fsDeleteEntry/fsSetNote, pure mergeHistorySnapshot, migrateLocalHistory idempotent, **signInWithCode + codeToEmail/emailToCode** (employee-code adapter)
- [x] **`src/main.js` — 3-phase boot:** A theme+lang เสมอ · B initFirebase + onAuthChange (no user→showLoginOverlay, user→enterApp, sign-out mid-session→`location.reload()`) · C enterApp await first snapshot + migration + reveal account row + reveal header sign-out + run app init
- [x] **`src/history.js` seam:** loadHistory→getHistoryCache when signed in, writes route to `fs*`, live re-render subscribeHistoryChange, consumers ไม่แตะ
- [x] **Migration:** flag `csa_migrated_<uid>`, `writeBatch` idempotent, ไม่ลบ `csa_history_v1`
- [x] **`index.html`:** `#loginOverlay` (employee-code field, eye toggle, lang switcher), account section + sign-out ใน Settings, sign-out entry ในเมนู header
- [x] **`src/wiring.js`:** login submit + sign-out (close menu ก่อน sign out)
- [x] **`src/translations.js` — 4 ภาษาครบ:** `login_title/subtitle`, `login_code_label` (แทน email/password), `login_signin_btn/signing_in`, `login_err_invalid/toomany/network/generic`, `set_account`, `account_signed_in_as` (= "รหัสพนักงาน"), `account_signout`
- [x] **`firestore.rules`:** users/{uid}/history owner-only, ทุกอย่างอื่น deny
- [x] **`test/history-cache.test.js`:** 7 tests สำหรับ `mergeHistorySnapshot`
- [x] **`test/translations.test.js`** ผ่าน (4 ภาษา ครบ)
- [x] `npm test` 112 pass, `npm run build` clean
- [x] **Bump version 1.20.0** (src/version.js, public/sw.js, package.json, index.html footer — enforced by version.test.js)

### 🔧 คุณต้องทำใน Firebase Console (ผมทำแทนไม่ได้)

- [ ] Firebase Console → เปิด Authentication → Sign-in method → **Email/Password** provider
- [ ] Firestore Database → Create database (production mode) ถ้ายังไม่มี
- [ ] Firestore → **Rules** → วางเนื้อจาก `firestore.rules` → Publish
  (หรือรัน `firebase deploy --only firestore:rules` ถ้าติดตั้ง firebase CLI แล้ว)
- [ ] Authentication → Settings → **Authorized domains** → เพิ่ม `localhost` (dev)
  (`*.vercel.app` + custom domain ค่อยเพิ่มตอน Phase 4)
- [ ] Authentication → Users → **Add user** ทีละคน: email `<code>@ie-calc.internal`, password `<code>` (ค่าเดียวกัน)
  - ⚠ พยายามใช้รหัสที่ไม่เรียงกันเป๊ะ (68020001, 02, 03…) เพราะเดาได้ง่าย

### 🧪 Manual E2E (บน http://localhost — user test เอง ผมไม่เปิด preview)

- [ ] รหัสผิด → error ตรงภาษา (`login_err_invalid`)
- [ ] รหัสถูก → เข้าแอป, snapshot มา, history render
- [ ] Save entry → เห็น doc ใน `/users/{uid}/history` (Firebase Console)
- [ ] Reload → เข้าตรง (session ค้าง IndexedDB, ไม่ผ่าน overlay)
- [ ] Sign out (Settings หรือ header menu) → กลับหน้า login, reload
- [ ] Login user คนที่ 2 → history ว่าง; user #1 ไม่เห็นของ user #2 (ยิงจาก Rules Playground ยืนยัน cross-uid reject)
- [ ] Reload หลัง migration → ไม่ migrate ซ้ำ (Network tab: ไม่มี batch write เพิ่ม)
- [ ] Offline (DevTools) → save ได้ (แค่ cache) → กลับ online → sync ขึ้น
- [ ] Language switcher บน login card → text update ทันที
- [ ] Eye toggle → บู๊ตขึ้น = password, กดตา = text, กดอีก = password

### 🚀 หลัง E2E ผ่าน

- [ ] Merge `phase-2-firebase` → `main` (**รอ user สั่ง push ก่อนเสมอ** — deploy ทันที)

---

## Phase 3 — ปกป้องโค้ด

**Branch:** `phase-3-protect`

### Code tasks — ✅ ทำเสร็จหมด

- [x] `vite.config.js`: `build.sourcemap: false` (ยืนยัน `.map` 0 ไฟล์ใน `dist/`)
- [x] `vite-plugin-javascript-obfuscator` ที่ `apply: 'build'` (dev/HMR ยังอ่านง่าย):
  - [x] `controlFlowFlattening` 0.75
  - [x] `deadCodeInjection` 0.4
  - [x] `stringArray` + `base64` + threshold 0.75
  - [x] `selfDefending: true`
  - [x] `debugProtection: true` + interval 2000
  - [x] `disableConsoleOutput: true`
  - [x] `renameGlobals: false` (สำคัญ — ถ้า true จะพังเพราะ DOM ids)
  - [x] `include: ['src/**/*.js']`, `exclude: [/node_modules/]` (Firebase ห้ามแตะ)
- [x] Bundle size: **742 KB → 968 KB** (+30% raw, +50% gzip) — อยู่ในเกณฑ์ที่ยอมรับได้
  ต่ำกว่าเพดาน 2× ที่แผนตั้งไว้ · SW cache กลบผลกระทบหลังโหลดแรก
- [x] ตรวจ obfuscation จริง: 937 unique `_0x` hex ids, 5 ฟังก์ชันสำคัญ leak = 0
- [x] `LICENSE` — Proprietary/All rights reserved
- [x] Copyright header ใน `src/main.js`, `src/app.js`, `src/calc.js`, `src/auth.js`
- [x] `npm test` 112 pass, `npm run build` clean, build time 2 s (was 250 ms)

### 🔧 คุณต้องทำใน Google Cloud / Firebase Console (ผมทำแทนไม่ได้)

- [ ] **Google Cloud Console → APIs & Services → Credentials → Web API key**
  - **Application restrictions** → HTTP referrers → เพิ่ม `localhost/*`
    (Vercel domain + custom domain เพิ่มตอน Phase 4)
  - **API restrictions** → จำกัดเฉพาะ Firebase services ที่แอปใช้:
    Identity Toolkit API, Cloud Firestore API, Firebase Installations API,
    Firebase Cloud Messaging API (ถ้าใช้), Token Service API

### ⚠ Perf note

- `debugProtection` loop รันทุก 2 วินาที — สังเกตบนมือถือกลาง ถ้าหนักลด threshold
- `disableConsoleOutput` ทำให้ console.* เงียบใน production — GA4 tracking ยังทำงาน

### 🚀 หลังคุณตั้ง API key restrictions

- [ ] Merge `phase-3-protect` → `main` (รอ user สั่งเสมอ)

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

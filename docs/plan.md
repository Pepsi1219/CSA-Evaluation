# แผนงานลงมือ (Execution Checklist)

เอกสารนี้คือ **checklist การทำงานจริง** ที่แตกจาก [plan-backend-firebase.md](./plan-backend-firebase.md) — เอกสารนั้นบอก "ทำอะไร/ทำไม" ส่วนไฟล์นี้บอก "step-by-step และเช็คเมื่อทำเสร็จ" กันลืม/กันข้ามขั้นตอน

**หลัก:** commit เป็นก้อนย่อย ผ่านเช็คพอยต์เขียวทุกก้อน • ทุก sub-commit ต้อง `npm test` ผ่าน • ห้าม `git push` โดยไม่ได้รับคำสั่งชัด (deploy จริงกับผู้ใช้จริง)

**Branch strategy:** ทำบน branch แยก `phase-1-vite-esm` → merge เข้า `main` เมื่อจบ Phase 1 ทั้งก้อน • Phase 2/3/4 branch แยกแต่ละเฟส

---

## 📊 สถานะโปรเจกต์ปัจจุบัน (2026-08-24)

**Live:** https://csa-evaluation.vercel.app — v1.21.0 (main HEAD)

| Phase | Status | รายละเอียด |
|---|---|---|
| **1** Vite + ESM | ✅ merged main | 4 commits (1a toolchain, 1b ESM, 1c wiring, 1d public/+CLAUDE.md) |
| **2** Firebase Auth + Firestore | ✅ merged main + tested | employee-code login (`<code>@ie-calc.internal`), password+eye, lang switcher, sign out, migration |
| **3** Obfuscation | ✅ merged main | controlFlow + stringArray(base64) + deadCode — **debugProtection/selfDefending OFF** (freezes UI) |
| **4** Vercel + PWA | ✅ live production | `vite-plugin-pwa` injectManifest, `vercel.json` cache-control, deploy from `main` branch |
| **Post-deploy hotfixes** | ✅ live | 3 fixes: obfuscator freeze, boot splash, dev pre-bundle firebase |

**Firebase Console:** Rules published, Authorized domain `csa-evaluation.vercel.app` added, Users add by admin manually

**เหลือทำ (ผู้ใช้ตัดสินใจว่าจะทำเมื่อไร):**
- Custom domain (ถ้าจะย้ายจาก `csa-evaluation.vercel.app`)
- ปิด GitHub Pages (ถ้าเลิกใช้ — Vercel รับช่วงแล้ว)
- Code-split Firebase → chunk แยก (ลด initial bundle 962→~500KB) — เป็น perf tuning ไม่ใช่ blocker

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

### ⏭ ข้ามโดยผู้ใช้ตัดสินใจ — 2026-08-24

- ~~Google Cloud Console → Web API key restrictions (HTTP referrers + API restrictions)~~
  **เหตุผลที่ข้าม:** Firestore Rules + Auth allowlist ป้องกันข้อมูลอยู่แล้ว
  การ restrict API key ป้องกันเฉพาะ **quota abuse** (คนอื่น copy `apiKey` ไปยิงจน
  quota Spark หมด → แอปดาวน์ชั่วคราว **ไม่มีบิลเข้ามา** เพราะไม่ผูกบัตร)
  สำหรับ shop-floor scale ความเสี่ยงต่ำ ถ้าอนาคตเจอ quota abuse ค่อยกลับมาตั้ง

### ⚠ Perf note

- `debugProtection` loop รันทุก 2 วินาที — สังเกตบนมือถือกลาง ถ้าหนักลด threshold
- `disableConsoleOutput` ทำให้ console.* เงียบใน production — GA4 tracking ยังทำงาน

### 🚀 พร้อม merge

- [ ] Merge `phase-3-protect` → `main` (รอ user สั่งเสมอ)

---

## Phase 4 — Deploy Vercel + PWA/SW

**Branch:** `phase-4-vercel`

### Code tasks — ✅ ทำเสร็จหมด

- [x] `vite.config.js`: `vite-plugin-pwa` `injectManifest`, `srcDir: 'src'`, `filename: 'sw.js'`, `injectRegister: null` (main.js register เอง), `devOptions.enabled: false`
- [x] ย้าย `public/sw.js` → `src/sw.js` — เขียนใหม่ใช้ `self.__WB_MANIFEST` แทน hardcoded ASSETS, ใช้ per-URL `cache.add(...).catch()` (แทน atomic addAll กัน 404 ตัวเดียวพังทั้ง install), รักษา CACHE literal + network-first 3s + fallback cascade + synthetic 503 เหมือนเดิม
- [x] `test/version.test.js` → path `src/sw.js`
- [x] `npm run build` verified: 16 precache entries (2681 KiB), CACHE=`csa-v1.21.0` ใน dist/sw.js, 0 WB_MANIFEST leak, 0 `.map`
- [x] `.env.example` มีอยู่แล้ว (Phase 2)
- [x] `vercel.json`: `framework: vite`, cache-control headers (sw + index no-cache, hashed assets immutable)
- [x] อัพเดต `CLAUDE.md`: SW ย้าย public/→src/, injectManifest, per-URL cache.add
- [x] Bump 1.21.0 (src/version.js, src/sw.js, package.json, index.html — 4 places, tested)
- [x] `npm test` 112 pass

### 🔧 คุณต้องทำใน Vercel + Firebase Console (ผมทำแทนไม่ได้)

- [x] **Vercel dashboard** — Project เชื่อมกับ GitHub repo `Pepsi1219/CSA-Evaluation`, framework=Vite auto-detected
- [x] **Vercel → Settings → Environment Variables** เพิ่มทั้ง 6 `VITE_FIREBASE_*` ครบ (All Environments)
- [x] Deploy สำเร็จ → **https://csa-evaluation.vercel.app** (live)
- [x] **Firebase Console → Authorized domains** เพิ่ม `csa-evaluation.vercel.app`
- [x] Manual E2E บน production URL: login, save, reload, sign out — ผ่านทั้งหมด
- [ ] Custom domain (ถ้าจะทำ) — Vercel → Settings → Domains + Firebase Authorized domains
- [ ] เอา GitHub Pages ออก (ถ้าเลิกใช้)

### 🔧 Post-deploy hotfixes (main branch)

หลัง merge phase-4-vercel เข้า main แล้ว deploy บน Vercel ค้นพบ 3 ปัญหา — แก้แล้วทั้งหมด:

- [x] **`72a62ae` fix: turn off debugProtection + selfDefending**
  Phase 3 obfuscator เปิด `debugProtection: true` + interval 2000 → ยัด infinite `debugger;` loop เข้าโค้ด → หน้าเว็บ freeze คลิก/right-click ไม่ได้ ปิดถาวรพร้อมคอมเมนต์เตือน "Do NOT turn back on"
- [x] **`b0d3e82` fix: boot splash**
  HTML paint หน้า calc form ก่อน → ผู้ใช้เห็นแอปประมาณ 5 วิ ก่อน login overlay โผล่ทับ (bait-and-switch)
  แก้: `<body class="booting">` + `#bootSplash` (brand + spinner) ซ่อนทุกอย่างด้วย `visibility: hidden`
  `main.js` เรียก `endBoot()` เมื่อ decision resolves (login หรือ enterApp) + safety timeout 10s กัน splash ค้าง
- [x] **`6770d61` perf(dev): pre-bundle firebase**
  Local `npm run dev` boot ช้า ~5s เพราะ Vite serve firebase SDK เป็นหลายร้อย ESM module แยกไฟล์
  แก้: `optimizeDeps.include` ['firebase/app','firebase/auth','firebase/firestore'] → Vite pre-bundle ให้ตอน dev สตาร์ต · production ไม่กระทบ

---

## เช็คก่อนปิดโปรเจกต์

- [x] `CLAUDE.md` ตรงกับสถานะจริง (build model + src/ layout + Vite commands) — อัพเดตช่วง Phase 1d
- [x] `docs/plan-backend-firebase.md` = strategic; `docs/plan.md` (ไฟล์นี้) = execution
- [x] Firebase Console: Rules published, Authorized domains มี `localhost` + `csa-evaluation.vercel.app`
- [x] `.env` ไม่โผล่ใน git history (ยืนยัน: `git log --all -- .env` ว่างเปล่า, .gitignore ครอบ)
- [x] Live URL ทำงาน: login, save, sign out, reload — E2E ผ่าน
- [ ] Login user #2 ไม่เห็นข้อมูล user #1 (Rules Playground หรือ manual — user ยังไม่ได้เช็ค 2 users)
- ~~API key restricted~~ (ข้ามโดยผู้ใช้ตัดสินใจ — Rules ป้องกันข้อมูลแล้ว)

---

## Rollback plan (กรณีอะไรพัง)

- Vercel → Deployments → **⋮ → Instant Rollback** ไป deploy ก่อนหน้าที่ Ready — ~10 วิ, ไม่ต้อง touch git
- ถ้าพังลึก (bad commit บน main) → local `git revert <sha>` + push → Vercel deploy revert ทับ
- Firebase หยุดทำงาน → เอาค่า `VITE_FIREBASE_API_KEY` ออกจาก Vercel env vars + Redeploy → แอปกลับไปเป็นโหมด localStorage (Phase 1 behaviour) ชั่วคราว
- ต้องกลับไป GitHub Pages ชั่วคราว → เปิด Pages ที่ Settings + revert main กลับ commit ก่อน Phase 1a (`c2645eb` "Move language + theme...")

# แผน (ฉบับปรับใหม่): Vite + ES modules · ปกป้องโค้ดเต็มที่ · Firebase Auth/Firestore · Deploy Vercel

## Context (ทำไมต้องทำ)

เจ้าของโปรเจกต์ต้องการ 3 อย่าง หลังจากลงแรงพัฒนาแอปมานาน:
1. **กันคนแกะลอจิก/ก๊อปโค้ด** ให้มากที่สุด
2. **จำกัดคนเข้าใช้** ด้วยบัญชีรายคน + เก็บข้อมูลประวัติแยกรายคนบนหลังบ้าน
3. **ย้าย deploy ไป Vercel** (จากเดิม GitHub Pages)

**การตัดสินใจที่ล็อกแล้ว:**
- **มี build step** — ใช้ **Vite** และ **แปลงทั้งโปรเจกต์เป็น ES modules**
- **ลอจิกคำนวณ (calc.js) คงไว้ฝั่ง client** แล้ว obfuscate — เพื่อรักษาความสามารถ
  ใช้งาน **offline** ของ PWA (สำคัญมากสำหรับโรงงาน wifi ไม่นิ่ง)
- **ใช้ทุกวิธีป้องกันโค้ด** (minify + obfuscate เข้ม, ปิด source map, repo ต้นฉบับ private, LICENSE)
- **Backend = Firebase** (Auth email+password รายคน + Firestore per-user + Security Rules)
- **Deploy = Vercel** (deploy จาก private repo ได้บน hobby tier)

**ความจริงที่ต้องรับทราบ (ตั้งความคาดหวัง):**
- เพราะเลือกให้ calc อยู่ฝั่ง client → **ลอจิกยังถูกแกะได้ในทางทฤษฎี** obfuscation แค่ทำให้
  ยากและเสียเวลามาก ไม่ใช่กันได้ 100% (การกันได้จริง 100% คือย้ายขึ้นเซิร์ฟเวอร์ ซึ่งเราสละไป
  เพื่อ offline)
- สิ่งที่ปกป้อง **ข้อมูล** ได้จริงคือ **Firestore Security Rules** ไม่ใช่ obfuscation
- `apiKey` ของ Firebase ไม่ใช่ความลับ ติดไปกับ client เสมอ — กันด้วย Rules + Authorized domains + จำกัด key ใน Google Cloud

---

## สถาปัตยกรรมเป้าหมาย

```
repo (private)
├── index.html              # <script type="module" src="/src/main.js"> เดียว
├── src/
│   ├── main.js             # entry: init + wiring ทั้งหมด (แทน bottom-of-script.js)
│   ├── version.js  calc.js  timeutil.js  translations.js
│   ├── chart.js  history.js  tutorial.js  app.js (เดิม script.js)
│   ├── auth.js             # ใหม่: Firebase config/gate/Firestore layer
│   └── wiring.js           # ใหม่: addEventListener แทน inline handler ทั้งหมด
├── public/
│   ├── manifest.json  icon.svg  assets/tutorial/**
│   └── (sw จัดการผ่าน vite-plugin-pwa injectManifest)
├── vite.config.js          # build + obfuscator + PWA
├── .env / .env.example     # VITE_FIREBASE_* (จริงตั้งใน Vercel dashboard, .env gitignored)
├── vercel.json             # (ออปชัน) preset Vite auto-detect
├── firestore.rules  LICENSE
└── test/ (ESM)
```

---

## Phase 1 — ย้ายไป Vite + ES modules (พื้นฐาน, เสี่ยงสุด, ทำก่อน โดยพฤติกรรมแอปไม่เปลี่ยน)

1. **ติดตั้ง toolchain:** `npm i -D vite vite-plugin-pwa vite-plugin-javascript-obfuscator`;
   `package.json` scripts: `"dev":"vite"`, `"build":"vite build"`, `"preview":"vite preview"`, คง `"test"`
2. **ย้ายไฟล์ไป `src/`** และแปลงเป็น ESM: แทน `if (module.exports){...}` ด้วย `export {...}`
   และเพิ่ม `import` ตามที่แต่ละไฟล์อ้าง global เดิม (เช่น history.js import จาก calc.js/translations.js)
   - `script.js` → `src/app.js` (ยังใหญ่สุด); ย้าย init block ท้ายไฟล์ไป `src/main.js`
3. **inline handlers ~57 จุด → addEventListener** (จำเป็นเพราะ ESM ฟังก์ชันไม่เป็น global อีก
   และการโยนขึ้น `window` จะทำลายผลของ obfuscation):
   - **index.html (41 จุด):** ลบ `oninput=/onclick=` ออก ใส่ `id`/`data-action` แล้วผูกใน `src/wiring.js`
     — ช่องกรอกเลขทั้งหมดผูก `input` → `calculateAll` ทีเดียวด้วย event delegation บนฟอร์ม
   - **HTML ที่ generate ใน JS (chart.js 2, app.js 1, tutorial.js 13):** เปลี่ยน `onclick="fn()"`
     เป็น `data-action` + delegation บน container (แพทเทิร์นนี้มีอยู่แล้วใน numpad/formula modal)
4. **index.html:** ลบ `<script defer>` 8 ตัว เหลือ `<script type="module" src="/src/main.js">` ตัวเดียว
5. **assets/manifest/icon** → `public/` (Vite คัดลอกขึ้น dist ตามเดิม, path คงที่ไม่ถูก hash)
6. **tests → ESM:** เพิ่ม `"type":"module"` ใน package.json; แปลง `require()` เป็น `import` ใน `test/*.js`;
   `version.test.js` ยังอ่านไฟล์เป็น text ได้ (ปรับ path ไป `src/` และแหล่ง SW literal — ดู Phase 4)
7. **ยืนยัน:** `npm run build` ผ่าน, `npm test` ผ่าน, `npm run preview` แอปทำงานเหมือนเดิมทุกฟีเจอร์
   (นี่คือเช็คพอยต์ "ไม่มี regression" ก่อนไปต่อ)

## Phase 2 — Firebase Auth + Firestore + ประตูล็อก (ตามแผนเดิม แต่เป็น ESM/bundled)

1. **`npm i firebase`** แล้ว `import { initializeApp } from 'firebase/app'`, `getAuth/...`,
   `getFirestore/...` (tree-shake + obfuscate ได้ ดีกว่าโหลด CDN)
2. **`src/auth.js`:** config อ่านจาก `import.meta.env.VITE_FIREBASE_*`; `initFirebase()` (เปิด Firestore
   offline persistence), `signIn/signOutUser`, `onAuthStateChanged`; data layer per-user:
   `onSnapshot` → cache ในหน่วยความจำ + `getHistoryCache()`; `fsSaveEntry/fsDeleteEntry/fsSetNote`
   (doc id = `entry.id`); pure `mergeHistorySnapshot(entries)` (dedupe→sort ts desc→cap `HISTORY_MAX`) export ไว้เทสต์
3. **ประตูล็อกใน `src/main.js`:** แยก boot เป็น
   - Phase A (รันเสมอ): init theme + language ก่อน เพื่อให้หน้า login มีธีม/แปลถูก
   - Phase B `async initApp()`: `await initFirebase()` → `onAuthStateChanged` (มี user→`enterApp`,
     ไม่มี→`showLoginOverlay`, sign-out ระหว่างใช้งาน→`location.reload()` กันข้อมูลข้ามคน);
     fast path: session ค้าง IndexedDB คืน user ทันที ไม่มี overlay กระพริบ
   - Phase C `enterApp(user)`: `await` snapshot แรก → migration → ซ่อน overlay → รัน init ตัวแอป
     (restoreFormState/restoreStopwatchState/... /calculateAll/_flushHeavyUpdate/loadWebFonts)
4. **history.js seam:** `loadHistory()` คืน cache เมื่อ flag เปิด+ล็อกอิน (ไม่งั้น localStorage เดิม);
   `saveCurrentToHistory/deleteHistoryEntry/setHistoryNote` branch ไป `fs*`; **consumer ไม่แตะ**
5. **Migration ครั้งแรก/uid:** กัน flag `csa_migrated_<uid>` → `writeBatch` `setDoc(id=entry.id)` (idempotent)
   → commit → ตั้ง flag; ไม่ลบ `csa_history_v1`
6. **index.html:** `#loginOverlay` (คัดจาก `#onboardingOverlay`; input email/password เป็น text ปกติ
   ห้ามใส่ `inputmode=none`/numpad); section บัญชี + ปุ่ม Sign out ใน `#settingsModal`
7. **translations.js:** เพิ่มคีย์ครบ **4 ภาษา** (th/en/vn/la) — ไม่งั้น translations.test.js fail:
   `login_title/subtitle`, `login_email_label/ph`, `login_password_label/ph`, `login_signin_btn`,
   `login_signing_in`, `login_offline_note`, error: `login_err_invalid/toomany/network/generic`,
   บัญชี: `set_account`, `account_signed_in_as` (**คง `{email}` ทุกภาษา**), `account_signout`
8. **Firestore Security Rules** (`firestore.rules`, เผยแพร่ใน console):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/history/{entryId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
       match /{document=**} { allow read, write: if false; }
     }
   }
   ```

## Phase 3 — ปกป้องโค้ดเต็มที่

1. **Vite build:** `build.sourcemap:false`, minify (esbuild/terser)
2. **`vite-plugin-javascript-obfuscator`** ตั้งค่าเข้ม: `controlFlowFlattening`, `deadCodeInjection`,
   `stringArray`+encoding (base64/rc4)+`stringArrayThreshold`, `selfDefending`, `debugProtection`,
   `disableConsoleOutput`, `renameGlobals` — **จูนความแรง** เทียบกับ perf/ขนาด bundle (ของแรงเกินทำให้ช้า/ใหญ่)
   ให้ obfuscate เฉพาะโค้ดเรา ไม่ใส่ทับ node_modules/firebase (ช้าและอาจพัง)
3. **repo ต้นฉบับ private** — Vercel deploy จาก private repo ได้ (hobby tier)
4. **`LICENSE` แบบสงวนลิขสิทธิ์ + copyright header** ในไฟล์หลัก (ให้สิทธิ์ฟ้องได้ตามกฎหมาย)
5. **จำกัด Firebase API key** ใน Google Cloud Console ให้ใช้ได้เฉพาะโดเมน Vercel + Firebase APIs
6. **ตั้งความคาดหวัง:** obfuscation = การกีดกัน ไม่ใช่ความลับสมบูรณ์; Rules คือการปกป้องข้อมูลจริง

## Phase 4 — Deploy Vercel + PWA/SW

1. **`vite-plugin-pwa` (injectManifest):** คงลอจิก sw ที่จูนมือไว้ (network-first + version cache)
   แต่ให้ปลั๊กอิน inject precache manifest (ชื่อไฟล์ที่ถูก hash) — แก้ปัญหา Vite hash ชนกับ ASSETS list เดิม
   - ย้ายลอจิก `sw.js` เป็น custom service worker source ที่ปลั๊กอินรับ; `CACHE` literal ยังอยู่ในซอร์ส →
     `version.test.js` ยังตรวจได้
2. **env vars ใน Vercel dashboard:** `VITE_FIREBASE_*` (ไม่ commit `.env`); เพิ่ม `.env.example` เป็นแม่แบบ
3. **`vercel.json`** (ถ้าจำเป็น): build `vite build`, output `dist/`; Vercel มัก auto-detect Vite อยู่แล้ว
4. **Firebase Authorized domains:** เพิ่มโดเมน Vercel (`*.vercel.app` + custom domain) และ `localhost`
5. **version bump:** `APP_VERSION` (src/version.js), `CACHE` (sw source), `package.json`, footer fallback (index.html) ให้ตรงกัน (version.test.js บังคับ)

---

## Critical files
- `vite.config.js` (ใหม่) — build, obfuscator, PWA injectManifest
- `src/main.js` (ใหม่) — entry + boot 3 เฟส + ประตูล็อก
- `src/wiring.js` (ใหม่) — addEventListener แทน inline handler ~57 จุด
- `src/auth.js` (ใหม่) — Firebase config/gate/Firestore layer + pure mergeHistorySnapshot
- `src/history.js` — รีรูต seam (consumer ไม่แตะ)
- `src/app.js` (เดิม script.js) — ตัด init block ออก, ตัด inline-handler dependency
- `index.html` — script module เดียว, login overlay, settings account section, ลบ inline handler
- `src/translations.js` — คีย์ใหม่ครบ 4 ภาษา
- `firestore.rules`, `LICENSE`, `.env.example`, `vercel.json` (ใหม่)
- ทุกไฟล์ `src/*.js` — แปลง `module.exports` → `export`; `test/*.js` — `require` → `import`

## การตรวจสอบ
- **หลัง Phase 1 (เช็คพอยต์ no-regression):** `npm run build` + `npm test` ผ่าน; `npm run preview`
  ทุกฟีเจอร์ทำงานเหมือนเดิม (ยังไม่มี Firebase)
- **Automated:** `test/history-cache.test.js` ทดสอบ `mergeHistorySnapshot` + idempotent migration;
  translations.test.js + version.test.js ต้องผ่าน (ทุกอย่างหลัง `FIREBASE_ENABLED` ให้ node import ได้)
- **Manual E2E (ผ่าน http/https, ไม่ใช่ file://):** รหัสผิด→error, ถูก→เข้าแอป; save→เห็น doc ใน
  `/users/{uid}/history`; reload→เข้าตรง; sign out→login กลับมา; user คนที่ 2 history ว่าง (ยืนยัน Rules Playground);
  migration ไม่ซ้ำ; offline→save ได้แล้ว sync; ตรวจ bundle prod ว่า obfuscate จริง + ไม่มี source map
- ตาม CLAUDE.md: ไม่เปิด browser preview เอง — ผู้ใช้ตรวจ UI/CSS เอง

## หมายเหตุความเสี่ยง/ขอบเขต
- Phase 1 คืองานใหญ่สุดและเสี่ยงสุด (เปลี่ยน build model + refactor ~57 handler + แปลง ESM ทั้งหมด)
  แนะนำ commit เป็นก้อนแยกและผ่านเช็คพอยต์ no-regression ก่อนเริ่ม Phase 2
- ต้องอัปเดต `CLAUDE.md` ครั้งใหญ่ (โปรเจกต์เลิก "no-build" แล้ว — โครงสร้าง/คำสั่ง/สถาปัตยกรรมเปลี่ยน)
- ควรทำเป็นหลาย PR (Phase 1 / Phase 2 / Phase 3-4) เพื่อ review ง่ายและลดความเสี่ยง

// ============================================================
// TUTORIAL — in-app learning centre: guided lessons (Photoshop-style,
// real app screenshots) → comprehension quiz → modern e-certificate.
//
// Rendered entirely by this file into #tutorialBody (the same "generate
// the DOM in JS" pattern as history.js / chart.js). Content is stored as
// { th, en, ... } objects and resolved with L() — Thai-first, falling back
// to Thai for any language not yet translated, so more languages can be
// added later without touching the engine. Progress persists in
// localStorage under csa_tutorial_v1.
//
// Depends on globals resolved at call time (all defined by load order):
//   currentLang (script.js), t() (script.js), gaTrack() (script.js).
// ============================================================

import { currentLang, gaTrack } from './state.js';
import {
    FIREBASE_ENABLED, isSignedIn, getTutorialCache,
    fsSaveTutorial, subscribeTutorialChange, mergeTutorialProgress,
} from './auth.js';

// True when tutorial reads/writes should route to Firestore instead of
// localStorage: backend configured AND a user is signed in.
function _useCloud() { return FIREBASE_ENABLED && isSignedIn(); }

const TUT_IMG = 'assets/tutorial/';
const STORAGE_KEY_TUT = 'csa_tutorial_v1';
const QUIZ_PASS_PCT = 80;   // ≥ 80% to pass
const COURSE_NAME = { th: 'การใช้งาน Industrial Engineering Calculator', en: 'Industrial Engineering Calculator — Operator Proficiency' };

// Pick the string for the current language, falling back to Thai.
function L(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[currentLang] || obj.th || '';
}

// Resolve a step screenshot's URL for the active language.
//   Thai (default)  → assets/tutorial/<file>          (flat — the fallback base)
//   en / vn / la    → assets/tutorial/<lang>/<file>   (same filename, per-language folder)
// The base filename is identical across languages; only the folder changes, so a
// lesson keeps one stable name (e.g. 'overview.png') in every language. Until a
// language's screenshots are added, the <img> onerror handler falls back to the
// Thai capture (see the lesson view), so the tutorial always renders something.
function _stepImgSrc(file, lang) {
    lang = lang || (typeof currentLang !== 'undefined' ? currentLang : 'th');
    return (lang && lang !== 'th') ? `${TUT_IMG}${lang}/${file}` : `${TUT_IMG}${file}`;
}

// ---- Content: categories → lessons → steps (each step = 1 screenshot + caption)
const TUTORIAL_DATA = [
    {
        id: 'start',
        title: { th: 'เริ่มต้นใช้งาน', en: 'Getting started' },
        desc:  { th: 'รู้จักหน้าจอ เมนู และการป้อนตัวเลข', en: 'The screen, the menu, and entering numbers' },
        lessons: [
            {
                id: 'overview',
                title: { th: 'ภาพรวมหน้าจอ', en: 'Screen overview' },
                steps: [
                    { img: 'overview.png', cap: { th: 'หน้าหลักแบ่งเป็น 4 ส่วนเรียงลงมา: ตั้งเป้าหมาย → บันทึกผลจริง → คุณภาพ → แผนการฝึก ช่องผลลัพธ์ (พื้นเขียว/ม่วงอ่อน) คำนวณให้อัตโนมัติเมื่อคุณกรอกข้อมูล', en: 'The home screen has four stacked sections: Target → Actual → Quality → Training plan. Result fields (tinted) compute automatically as you type.' } },
                    { img: 'menu.png', cap: { th: 'ปุ่มสามจุดมุมขวาบนคือเมนูรวม: ดาวน์โหลด CSV, บันทึก PDF, ประวัติการประเมิน, ตั้งค่า (ธีม/ภาษา/บทเรียน) และล้างข้อมูล', en: 'The three-dot button (top-right) is the menu: CSV, PDF, history, Settings (theme/language/tutorial) and reset.' } },
                ],
            },
            {
                id: 'numpad',
                title: { th: 'ป้อนตัวเลขด้วยแป้นในแอป', en: 'Entering numbers with the in-app keypad' },
                steps: [
                    { img: 'numpad.png', cap: { th: 'แตะช่องตัวเลขใดก็ได้ แป้นตัวเลขของแอปจะเด้งขึ้นมาแทนคีย์บอร์ดของเครื่อง ช่องที่รับทศนิยมจะมีปุ่มจุด (.) กด “ตกลง” เพื่อยืนยัน หรือ “ลบ/ล้าง” เพื่อแก้ไข', en: 'Tap any number field and the app keypad opens instead of the OS keyboard. Decimal fields show a dot key. Press Done to confirm, or Backspace/Clear to edit.' } },
                ],
            },
        ],
    },
    {
        id: 'target',
        title: { th: 'การตั้งเป้าหมาย', en: 'Setting the target' },
        desc:  { th: 'ค่า SAM เป้าหมายประสิทธิภาพ และการอ่านผล', en: 'SAM, target efficiency, and reading the results' },
        lessons: [
            {
                id: 'sam',
                title: { th: 'ค่า SAM และเป้าหมายประสิทธิภาพ', en: 'SAM and target efficiency' },
                steps: [
                    { img: 'sam-target.png', cap: { th: 'ป้อน “ค่า SAM” (เวลามาตรฐานต่อชิ้น) เลือกหน่วยนาที/วินาทีได้ แล้วป้อน “เป้าหมายประสิทธิภาพ (%)” ที่ต้องการ', en: 'Enter the SAM (standard time per piece) — choose minutes or seconds — then the target efficiency (%).' } },
                    { img: 'sam-target.png', cap: { th: 'ระบบคำนวณ “เป้าหมายชิ้นงาน (ชิ้น/ชม.)” และ “ค่า SAM ใหม่” ที่ต้องทำให้ได้เพื่อถึงเป้าหมายให้อัตโนมัติ', en: 'The app derives the target output (pcs/hr) and the New SAM you must hit to reach that target.' } },
                ],
            },
            {
                id: 'formula',
                title: { th: 'ดูวิธีคำนวณ (ปุ่ม ⓘ)', en: 'See how it is calculated (the ⓘ button)' },
                steps: [
                    { img: 'formula-modal.png', cap: { th: 'ทุกช่องผลลัพธ์มีไอคอน ⓘ ข้างชื่อ แตะเพื่อดู “สูตร”, “คำอธิบาย” และ “ค่าที่คุณป้อน” ที่แทนลงในสูตรจริง ช่วยตรวจสอบตัวเลขได้', en: 'Every result label has an ⓘ icon. Tap it to see the formula, an explanation, and your own values substituted into it — handy for auditing the number.' } },
                ],
            },
        ],
    },
    {
        id: 'measure',
        title: { th: 'วัดผลจริง', en: 'Measuring the actual' },
        desc:  { th: 'จับเวลา, Time Study และประสิทธิภาพจริง', en: 'Stopwatch, Time Study, and actual efficiency' },
        lessons: [
            {
                id: 'stopwatch',
                title: { th: 'จับเวลาด้วยนาฬิกาจับเวลา', en: 'Timing with the stopwatch' },
                steps: [
                    { img: 'stopwatch.png', cap: { th: 'แตะแถบ “จับเวลา” เปิดนาฬิกา โหมด Lap เก็บเวลาแต่ละรอบ (กด Lap ทุกจบรอบ) โหมด Single จับครั้งเดียว มีปุ่มพัก/ทำต่อ และลบรอบที่ผิดได้', en: 'Open the stopwatch from the Timing bar. Lap mode records each round (press Lap each cycle); Single mode times once. You can pause/resume and delete a bad lap.' } },
                    { img: 'stopwatch.png', cap: { th: 'เมื่อกด Stop จะสรุปค่าเฉลี่ย, ต่ำสุด/สูงสุด และส่วนเบี่ยงเบนมาตรฐาน จากนั้นกด “บันทึกลงฟอร์ม” เพื่อส่งเวลาเข้าช่องบันทึกผลจริงอัตโนมัติ', en: 'Press Stop for a summary (mean, min/max, standard deviation), then “Save to form” to push the time into the Actual section automatically.' } },
                ],
            },
            {
                id: 'timestudy',
                title: { th: 'Time Study — หาจำนวนรอบที่ต้องจับ', en: 'Time Study — required number of rounds' },
                steps: [
                    { img: 'time-study.png', cap: { th: 'หลังจับเวลาแบบ Lap ≥ 2 รอบ ระบบคำนวณ “จำนวนรอบที่ควรจับ (N)” ตามหลักสถิติ (การกระจายตัว t) เลือกความเชื่อมั่น 90/95/99% และค่าคลาดเคลื่อนที่ยอมรับได้', en: 'After ≥ 2 laps, the app computes the statistically required sample size N (Student-t). Pick 90/95/99% confidence and the acceptable error.' } },
                    { img: 'time-study.png', cap: { th: 'ถ้าจับยังไม่พอ จะมีปุ่ม “จับเวลาเพิ่ม” บอกว่าต้องเก็บอีกกี่รอบ เก็บจนครบ N แล้วค่าเฉลี่ยจึงน่าเชื่อถือ', en: 'If you have too few, a “keep timing” button tells you how many more rounds to collect until N is met and the mean is reliable.' } },
                ],
            },
            {
                id: 'actual',
                title: { th: 'อ่านประสิทธิภาพจริงและสถานะสี', en: 'Reading actual efficiency & the status colour' },
                steps: [
                    { img: 'actual-status.png', cap: { th: 'จากเวลารวม/จำนวนรอบ ระบบหา “เวลาต่อรอบ”, “ประสิทธิภาพจริง (%)” และ “ชิ้น/ชม.” สีพื้นบอกสถานะเทียบเป้าหมาย: เขียว = ดี, เหลือง = ต้องระวัง, แดง = ต่ำกว่าเกณฑ์', en: 'From total time / rounds the app derives cycle time, actual efficiency (%) and pcs/hr. The background colour grades it against target: green = good, amber = watch, red = below target.' } },
                ],
            },
        ],
    },
    {
        id: 'quality',
        title: { th: 'คุณภาพ', en: 'Quality' },
        desc:  { th: 'อัตราการผ่าน (pass rate)', en: 'Pass rate' },
        lessons: [
            {
                id: 'passrate',
                title: { th: 'อัตราการผ่าน', en: 'Pass rate' },
                steps: [
                    { img: 'quality.png', cap: { th: 'ป้อนจำนวนที่ “ผ่าน” และ “ไม่ผ่าน” ระบบคำนวณอัตราการผ่าน (%) โดย “ปัดลง” เสมอ เพื่อไม่ให้รายงานคุณภาพเกินจริง (เช่น 999/1000 = 99% ไม่ใช่ 100%)', en: 'Enter the passed and failed counts. Pass rate (%) is always rounded down so quality is never overstated (e.g. 999/1000 = 99%, not 100%).' } },
                ],
            },
        ],
    },
    {
        id: 'training',
        title: { th: 'แผนการฝึก', en: 'Training plan' },
        desc:  { th: 'เส้นโค้งการเรียนรู้และกราฟ', en: 'Learning curve and chart' },
        lessons: [
            {
                id: 'plan',
                title: { th: 'สร้างแผนและอ่านกราฟ', en: 'Build the plan & read the chart' },
                steps: [
                    { img: 'training-chart.png', cap: { th: 'ป้อน “ระยะเวลาการฝึก” เมื่อประสิทธิภาพจริงยังต่ำกว่าเป้าหมาย ระบบจะสร้างแผนราย วัน/ชม. ไล่ระดับจากปัจจุบันไปถึงเป้าหมาย', en: 'Enter the training duration. When actual efficiency is below target, the app builds a day-by-day plan ramping from now up to the goal.' } },
                    { img: 'training-chart.png', cap: { th: 'กราฟเส้นโค้งการเรียนรู้แสดงช่องว่างจนถึงเป้าหมาย สลับดูเป็น “ชิ้น/ชม.” หรือ “Eff %” ได้ เส้นประแดงคือเป้าหมาย', en: 'The learning-curve chart shows the gap to target. Toggle between pcs/hr and Eff %; the red dashed line is the target.' } },
                ],
            },
        ],
    },
    {
        id: 'export',
        title: { th: 'บันทึกและส่งออก', en: 'Save & export' },
        desc:  { th: 'ประวัติ เปรียบเทียบ และไฟล์รายงาน', en: 'History, compare, and report files' },
        lessons: [
            {
                id: 'history',
                title: { th: 'ประวัติและการเปรียบเทียบ', en: 'History & compare' },
                steps: [
                    { img: 'history.png', cap: { th: 'บันทึกผลประเมินไว้ดูย้อนหลัง ตั้งชื่อ/โน้ตส่งกะได้ เลือก 2 รายการขึ้นไปเพื่อเปรียบเทียบแบบตารางเคียงกัน', en: 'Save an evaluation to review later, with a label / shift-handover note. Pick two or more to compare side by side in a table.' } },
                ],
            },
            {
                id: 'export',
                title: { th: 'ส่งออก CSV และ PDF', en: 'Export CSV & PDF' },
                steps: [
                    { img: 'menu.png', cap: { th: 'จากเมนู เลือก “ดาวน์โหลด CSV” (เปิดใน Excel ได้ ภาษาไทยไม่เพี้ยน) หรือ “บันทึกเป็น PDF” เพื่อทำรายงานสำหรับตรวจสอบ', en: 'From the menu choose CSV (opens cleanly in Excel, Thai intact) or Save as PDF for an audit-ready report.' } },
                ],
            },
        ],
    },
];

// ---- Quiz: 4 options each, `a` = index of the correct answer.
const QUIZ_DATA = [
    { q: { th: 'ค่า SAM หมายถึงอะไร?', en: 'What does SAM represent?' },
      o: [ { th: 'เวลามาตรฐานต่อชิ้น', en: 'Standard time per piece' }, { th: 'จำนวนชิ้นต่อชั่วโมง', en: 'Pieces per hour' }, { th: 'อัตราการผ่าน', en: 'Pass rate' }, { th: 'จำนวนพนักงาน', en: 'Number of workers' } ], a: 0 },
    { q: { th: 'ช่องผลลัพธ์คำนวณเมื่อใด?', en: 'When do result fields calculate?' },
      o: [ { th: 'อัตโนมัติเมื่อกรอกข้อมูล', en: 'Automatically as you type' }, { th: 'ต้องกดปุ่มคำนวณ', en: 'Only after pressing a calculate button' }, { th: 'เมื่อปิดแอป', en: 'When the app closes' }, { th: 'ทุกเที่ยงคืน', en: 'Every midnight' } ], a: 0 },
    { q: { th: 'ปุ่ม ⓘ ข้างชื่อผลลัพธ์ใช้ทำอะไร?', en: 'What is the ⓘ button next to a result for?' },
      o: [ { th: 'แสดงสูตรและค่าที่คุณป้อน', en: 'Shows the formula and your substituted values' }, { th: 'ลบข้อมูล', en: 'Deletes the data' }, { th: 'เปลี่ยนภาษา', en: 'Changes the language' }, { th: 'ปิดแอป', en: 'Closes the app' } ], a: 0 },
    { q: { th: 'โหมด Lap ของนาฬิกาจับเวลาใช้ทำอะไร?', en: 'What is the stopwatch Lap mode for?' },
      o: [ { th: 'เก็บเวลาของแต่ละรอบ', en: 'Recording each round’s time' }, { th: 'ตั้งปลุก', en: 'Setting an alarm' }, { th: 'นับถอยหลัง', en: 'Counting down' }, { th: 'จับเวลารวมครั้งเดียว', en: 'Timing once only' } ], a: 0 },
    { q: { th: 'ค่า N ใน Time Study บอกอะไร?', en: 'What does N in Time Study tell you?' },
      o: [ { th: 'จำนวนรอบที่ควรจับเพื่อให้น่าเชื่อถือ', en: 'How many rounds you should time to be reliable' }, { th: 'ประสิทธิภาพเป้าหมาย', en: 'The target efficiency' }, { th: 'จำนวนของเสีย', en: 'The number of defects' }, { th: 'ราคาต่อชิ้น', en: 'Cost per piece' } ], a: 0 },
    { q: { th: 'ต้องจับเวลาแบบ Lap อย่างน้อยกี่รอบ Time Study จึงคำนวณ N ได้?', en: 'How many laps at minimum before Time Study can compute N?' },
      o: [ { th: '2 รอบ', en: '2 laps' }, { th: '1 รอบ', en: '1 lap' }, { th: '10 รอบ', en: '10 laps' }, { th: '100 รอบ', en: '100 laps' } ], a: 0 },
    { q: { th: 'สีพื้นของประสิทธิภาพจริงเป็น “สีแดง” หมายถึง?', en: 'A red background on actual efficiency means?' },
      o: [ { th: 'ต่ำกว่าเกณฑ์ ต้องปรับปรุง', en: 'Below target — needs improvement' }, { th: 'ดีเยี่ยม', en: 'Excellent' }, { th: 'ยังไม่กรอกข้อมูล', en: 'No data yet' }, { th: 'เกินเป้าหมาย', en: 'Above target' } ], a: 0 },
    { q: { th: 'อัตราการผ่าน (pass rate) ปัดเศษอย่างไร?', en: 'How is the pass rate rounded?' },
      o: [ { th: 'ปัดลงเสมอ เพื่อไม่ให้เกินจริง', en: 'Always down, so it is never overstated' }, { th: 'ปัดขึ้นเสมอ', en: 'Always up' }, { th: 'ปัดตามปกติ', en: 'Normal rounding' }, { th: 'ไม่ปัดเลย', en: 'No rounding' } ], a: 0 },
    { q: { th: 'ไฟล์ CSV ที่ส่งออกเปิดที่ไหนได้ดี?', en: 'The exported CSV opens well in?' },
      o: [ { th: 'Excel (ภาษาไทยไม่เพี้ยน)', en: 'Excel (Thai intact)' }, { th: 'เครื่องคิดเลขเท่านั้น', en: 'A calculator only' }, { th: 'เปิดไม่ได้', en: 'Cannot be opened' }, { th: 'ต้องใช้อินเทอร์เน็ต', en: 'Requires the internet' } ], a: 0 },
    { q: { th: 'เมนู “ตั้งค่า” รวมอะไรไว้บ้าง?', en: 'The Settings menu contains?' },
      o: [ { th: 'ธีม ภาษา และบทเรียน', en: 'Theme, language, and the tutorial' }, { th: 'เฉพาะการลบข้อมูล', en: 'Only data deletion' }, { th: 'เฉพาะการพิมพ์', en: 'Only printing' }, { th: 'ไม่มีอะไร', en: 'Nothing' } ], a: 0 },
];

// ---- Progress storage (seam — mirrors history.js pattern) ----
// loadLocalTutProgress is the pure localStorage read, exported so auth.js's
// one-time reconciliation can pull whatever this device already had before
// the user first signed in on it.
export function loadLocalTutProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_TUT);
        const p = raw ? JSON.parse(raw) : null;
        if (!p || typeof p !== 'object') return { done: {}, quiz: null, cert: null };
        if (!p.done || typeof p.done !== 'object') p.done = {};
        return p;
    } catch (_) { return { done: {}, quiz: null, cert: null }; }
}
function loadTutProgress() {
    // Signed-in path returns the Firestore-fed cache so completion follows
    // the user across devices; offline / signed-out falls back to localStorage.
    return _useCloud() ? getTutorialCache() : loadLocalTutProgress();
}
function saveTutProgress(p) {
    // Always write locally first as an offline fallback + fast synchronous
    // re-read. If signed in, also write to Firestore (fire-and-forget — the
    // snapshot listener updates the cache and re-renders on ack).
    try { localStorage.setItem(STORAGE_KEY_TUT, JSON.stringify(p)); } catch (_) {}
    if (_useCloud()) {
        // Union-merge against whatever's currently in the cache so a stale
        // save doesn't wipe cross-device progress recorded elsewhere.
        const merged = mergeTutorialProgress(getTutorialCache(), p);
        fsSaveTutorial(merged);
    }
}

const _allLessonIds = TUTORIAL_DATA.flatMap(c => c.lessons.map(l => l.id));
function _lessonsDoneCount(p) { return _allLessonIds.filter(id => p.done[id]).length; }
function _allLessonsDone(p) { return _lessonsDoneCount(p) === _allLessonIds.length; }

// ---- Runtime view state ----
const _tut = { view: 'home', catId: null, lessonId: null, step: 0, quiz: null };

function _tg(id) { return document.getElementById(id); }
function _esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---- Open / close ----
export function openTutorial() {
    _tut.view = 'home';
    _tg('tutorialModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (typeof gaTrack === 'function') gaTrack('tutorial_open');
    // Kick off image preloads in parallel so navigating between steps is
    // instant. Browser caches each fetch; the <img> tags rendered later
    // hit the memory cache instead of round-tripping. Runs once per session.
    _preloadTutorialImages();
    renderTutorial();
}

let _preloaded = false;
function _preloadTutorialImages() {
    if (_preloaded) return;
    _preloaded = true;
    const seen = new Set();
    for (const cat of TUTORIAL_DATA) {
        for (const lesson of cat.lessons) {
            for (const step of lesson.steps) {
                if (!step.img || seen.has(step.img)) continue;
                seen.add(step.img);
                new Image().src = _stepImgSrc(step.img);
            }
        }
    }
}
export function closeTutorial() {
    _tg('tutorialModal').style.display = 'none';
    document.body.style.overflow = '';
    updateTutProgressBadge();
}
// Top-bar back: step-back inside a lesson, otherwise return to the category home.
export function tutBack() {
    if (_tut.view === 'lesson' && _tut.step > 0) { _tut.step--; renderTutorial(); return; }
    if (_tut.view === 'home') { closeTutorial(); return; }
    _tut.view = 'home';
    renderTutorial();
}

// ---- Master render: dispatches on _tut.view and updates the top bar ----
function renderTutorial() {
    const body = _tg('tutorialBody');
    if (!body) return;
    const p = loadTutProgress();

    let html = '', progress = 0;
    if (_tut.view === 'home')        { html = _renderHome(p);   progress = _overallPct(p); }
    else if (_tut.view === 'lesson') { const r = _renderLesson(p); html = r.html; progress = r.progress; }
    else if (_tut.view === 'quiz')   { const r = _renderQuiz();    html = r.html; progress = r.progress; }
    else if (_tut.view === 'result') { html = _renderResult(p);  progress = 100; }
    else if (_tut.view === 'cert')   { html = _renderCert(p);    progress = 100; }

    body.innerHTML = html;
    body.scrollTop = 0;
    const bar = _tg('tutProgressBar');
    if (bar) bar.style.width = progress + '%';
    const back = _tg('tutBackBtn');
    if (back) back.style.visibility = _tut.view === 'home' ? 'hidden' : '';

    if (_tut.view === 'cert') _initCertView(p);
}

function _overallPct(p) {
    const total = _allLessonIds.length + 1; // lessons + quiz
    const done = _lessonsDoneCount(p) + (p.quiz && p.quiz.passed ? 1 : 0);
    return Math.round((done / total) * 100);
}

// ---- HOME: categories, lessons, and the quiz/certificate gate ----
function _renderHome(p) {
    const doneN = _lessonsDoneCount(p), totalN = _allLessonIds.length;
    const cats = TUTORIAL_DATA.map(cat => {
        const lessons = cat.lessons.map(les => {
            const done = !!p.done[les.id];
            return `
            <button type="button" class="tut-lesson-row" data-action="tut-lesson" data-cat="${cat.id}" data-lesson="${les.id}">
                <span class="tut-lesson-check ${done ? 'is-done' : ''}">${done
                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>'
                    : ''}</span>
                <span class="tut-lesson-name">${_esc(L(les.title))}</span>
                <span class="tut-lesson-arrow">›</span>
            </button>`;
        }).join('');
        return `
        <div class="tut-cat">
            <div class="tut-cat-head">
                <span class="tut-cat-title">${_esc(L(cat.title))}</span>
                <span class="tut-cat-desc">${_esc(L(cat.desc))}</span>
            </div>
            <div class="tut-lesson-list">${lessons}</div>
        </div>`;
    }).join('');

    const unlocked = _allLessonsDone(p);
    const passed = p.quiz && p.quiz.passed;
    const quizCard = `
    <div class="tut-quiz-card ${unlocked ? '' : 'is-locked'}">
        <div class="tut-quiz-icon">${passed
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : (unlocked
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>')}</div>
        <div class="tut-quiz-text">
            <span class="tut-quiz-title">${L({ th: 'แบบทดสอบวัดความเข้าใจ', en: 'Comprehension quiz' })}</span>
            <span class="tut-quiz-sub">${unlocked
                ? (passed
                    ? L({ th: 'ผ่านแล้ว · คะแนนดีที่สุด ', en: 'Passed · best score ' }) + p.quiz.best + '%'
                    : L({ th: '10 ข้อ · ผ่านที่ ', en: '10 questions · pass at ' }) + QUIZ_PASS_PCT + '%')
                : L({ th: 'เรียนให้ครบทุกบทเพื่อปลดล็อก (', en: 'Finish every lesson to unlock (' }) + doneN + '/' + totalN + ')'}</span>
        </div>
        ${unlocked
            ? `<button type="button" class="tut-quiz-btn" data-action="tut-quiz-start">${passed ? L({ th: 'ทำใหม่', en: 'Retake' }) : L({ th: 'เริ่มทำ', en: 'Start' })}</button>`
            : ''}
    </div>
    ${passed ? `<button type="button" class="tut-cert-link" data-action="tut-cert">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg>
        ${L({ th: 'ดู / ดาวน์โหลดใบรับรอง', en: 'View / download certificate' })}</button>` : ''}`;

    return `
    <div class="tut-home">
        <div class="tut-hero">
            <div class="tut-hero-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/><line x1="22" y1="10" x2="22" y2="15"/></svg>
            </div>
            <h2 class="tut-hero-title">${L({ th: 'ศูนย์การเรียนรู้', en: 'Learning centre' })}</h2>
            <p class="tut-hero-sub">${L({ th: 'เรียนทีละบทจากภาพหน้าจอจริง แล้วทำแบบทดสอบเพื่อรับใบรับรอง', en: 'Learn from real screenshots, then take the quiz for your certificate.' })}</p>
            <div class="tut-hero-meter"><div class="tut-hero-meter-fill" style="width:${_overallPct(p)}%"></div></div>
            <span class="tut-hero-meter-label">${_overallPct(p)}%</span>
        </div>
        ${cats}
        ${quizCard}
    </div>`;
}

export function tutOpenLesson(catId, lessonId) {
    _tut.view = 'lesson'; _tut.catId = catId; _tut.lessonId = lessonId; _tut.step = 0;
    if (typeof gaTrack === 'function') gaTrack('tutorial_lesson', { lesson: lessonId });
    renderTutorial();
}

function _findLesson(lessonId) {
    for (const c of TUTORIAL_DATA) { const l = c.lessons.find(x => x.id === lessonId); if (l) return l; }
    return null;
}

// ---- LESSON viewer: one screenshot + caption per step ----
function _renderLesson(p) {
    const les = _findLesson(_tut.lessonId);
    if (!les) { _tut.view = 'home'; return { html: _renderHome(p), progress: 0 }; }
    const n = les.steps.length;
    const i = Math.min(_tut.step, n - 1);
    const st = les.steps[i];
    const isLast = i === n - 1;

    const dots = les.steps.map((_, k) => `<span class="tut-step-dot ${k === i ? 'active' : ''}"></span>`).join('');
    const nextLabel = isLast ? L({ th: 'เรียนจบบทนี้', en: 'Finish lesson' }) : L({ th: 'ถัดไป', en: 'Next' });

    const html = `
    <div class="tut-lesson">
        <h2 class="tut-lesson-heading">${_esc(L(les.title))}</h2>
        <div class="tut-shot-frame">
            <img class="tut-shot" src="${_stepImgSrc(st.img)}" alt="${_esc(L(les.title))}"
                 loading="eager" decoding="async" fetchpriority="high"
                 onerror="this.onerror=null;this.src='${TUT_IMG}${st.img}'">
        </div>
        <p class="tut-caption">${_esc(L(st.cap))}</p>
        <div class="tut-step-dots">${dots}</div>
        <div class="tut-lesson-nav">
            <button type="button" class="tut-nav-btn ghost" ${i === 0 ? 'disabled' : ''} data-action="tut-step" data-arg="-1">${L({ th: 'ก่อนหน้า', en: 'Back' })}</button>
            <span class="tut-step-count">${i + 1} / ${n}</span>
            <button type="button" class="tut-nav-btn primary" data-action="tut-step" data-arg="1">${nextLabel}</button>
        </div>
    </div>`;
    return { html, progress: Math.round(((i + 1) / n) * 100) };
}

export function tutStep(dir) {
    const les = _findLesson(_tut.lessonId);
    if (!les) return;
    const n = les.steps.length;
    if (dir > 0 && _tut.step >= n - 1) {
        // Finish: mark done, return home.
        const p = loadTutProgress();
        p.done[_tut.lessonId] = true;
        saveTutProgress(p);
        if (typeof gaTrack === 'function') gaTrack('tutorial_lesson_done', { lesson: _tut.lessonId });
        _tut.view = 'home';
        renderTutorial();
        return;
    }
    _tut.step = Math.max(0, Math.min(n - 1, _tut.step + dir));
    renderTutorial();
}

// ---- QUIZ ----
function _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
export function tutStartQuiz() {
    // Shuffle question order and, per question, the option order (tracking the
    // new index of the correct answer).
    const order = _shuffle(QUIZ_DATA.map((_, i) => i));
    const questions = order.map(qi => {
        const item = QUIZ_DATA[qi];
        const optOrder = _shuffle(item.o.map((_, i) => i));
        return { qi, optOrder, answerPos: optOrder.indexOf(item.a), picked: null };
    });
    _tut.quiz = { questions, idx: 0 };
    _tut.view = 'quiz';
    if (typeof gaTrack === 'function') gaTrack('tutorial_quiz_start');
    renderTutorial();
}
function _renderQuiz() {
    const q = _tut.quiz;
    const cur = q.questions[q.idx];
    const item = QUIZ_DATA[cur.qi];
    const opts = cur.optOrder.map((oi, pos) => `
        <button type="button" class="tut-opt ${cur.picked === pos ? 'picked' : ''}" data-action="tut-pick" data-arg="${pos}">
            <span class="tut-opt-mark"></span>
            <span class="tut-opt-text">${_esc(L(item.o[oi]))}</span>
        </button>`).join('');
    const isLast = q.idx === q.questions.length - 1;
    const canNext = cur.picked !== null;
    const html = `
    <div class="tut-quiz">
        <div class="tut-quiz-count">${L({ th: 'ข้อ', en: 'Question' })} ${q.idx + 1} / ${q.questions.length}</div>
        <h2 class="tut-quiz-q">${_esc(L(item.q))}</h2>
        <div class="tut-opts">${opts}</div>
        <div class="tut-lesson-nav">
            <button type="button" class="tut-nav-btn ghost" ${q.idx === 0 ? 'disabled' : ''} data-action="tut-quiz-nav" data-arg="-1">${L({ th: 'ก่อนหน้า', en: 'Back' })}</button>
            <button type="button" class="tut-nav-btn primary" ${canNext ? '' : 'disabled'} data-action="tut-quiz-nav" data-arg="1">${isLast ? L({ th: 'ส่งคำตอบ', en: 'Submit' }) : L({ th: 'ถัดไป', en: 'Next' })}</button>
        </div>
    </div>`;
    return { html, progress: Math.round(((q.idx) / q.questions.length) * 100) };
}
export function tutPick(pos) {
    _tut.quiz.questions[_tut.quiz.idx].picked = pos;
    renderTutorial();
}
export function tutQuizNav(dir) {
    const q = _tut.quiz;
    if (dir > 0 && q.idx === q.questions.length - 1) { _tutGradeQuiz(); return; }
    q.idx = Math.max(0, Math.min(q.questions.length - 1, q.idx + dir));
    renderTutorial();
}
function _tutGradeQuiz() {
    const q = _tut.quiz;
    const correct = q.questions.filter(x => x.picked === x.answerPos).length;
    const pct = Math.round((correct / q.questions.length) * 100);
    const passed = pct >= QUIZ_PASS_PCT;
    _tut.quizResult = { correct, total: q.questions.length, pct, passed };
    const p = loadTutProgress();
    const prevBest = (p.quiz && p.quiz.best) || 0;
    p.quiz = { passed: passed || (p.quiz && p.quiz.passed) || false, best: Math.max(prevBest, pct), at: Date.now() };
    saveTutProgress(p);
    if (typeof gaTrack === 'function') gaTrack('tutorial_quiz_done', { pct, passed });
    _tut.view = 'result';
    renderTutorial();
}
function _renderResult(p) {
    const r = _tut.quizResult || { correct: 0, total: QUIZ_DATA.length, pct: 0, passed: false };
    return `
    <div class="tut-result">
        <div class="tut-result-ring ${r.passed ? 'pass' : 'fail'}">
            <span class="tut-result-pct">${r.pct}%</span>
        </div>
        <h2 class="tut-result-title">${r.passed ? L({ th: 'ผ่าน! 🎉', en: 'Passed! 🎉' }) : L({ th: 'ยังไม่ผ่าน', en: 'Not passed yet' })}</h2>
        <p class="tut-result-sub">${L({ th: 'ตอบถูก ', en: 'Correct ' })}${r.correct}/${r.total} · ${L({ th: 'เกณฑ์ผ่าน ', en: 'pass mark ' })}${QUIZ_PASS_PCT}%</p>
        <div class="tut-result-actions">
            ${r.passed
                ? `<button type="button" class="tut-nav-btn primary" data-action="tut-cert">${L({ th: 'รับใบรับรอง', en: 'Get certificate' })}</button>`
                : `<button type="button" class="tut-nav-btn primary" data-action="tut-quiz-start">${L({ th: 'ลองใหม่', en: 'Try again' })}</button>`}
            <button type="button" class="tut-nav-btn ghost" data-action="tut-home">${L({ th: 'กลับหน้าหลัก', en: 'Back to home' })}</button>
        </div>
    </div>`;
}
export function tutGoHome() { _tut.view = 'home'; renderTutorial(); }

// ---- CERTIFICATE ----
export function tutOpenCert() {
    const p = loadTutProgress();
    if (!(p.quiz && p.quiz.passed)) { _tut.view = 'home'; renderTutorial(); return; }
    _tut.view = 'cert';
    renderTutorial();
}
function _certId(p) {
    if (p.cert && p.cert.id) return p.cert.id;
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const rnd = Math.random().toString(16).slice(2, 6).toUpperCase();
    return `IEC-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rnd}`;
}
function _renderCert(p) {
    const savedName = (p.cert && p.cert.name) || '';
    return `
    <div class="tut-cert">
        <h2 class="tut-cert-h">${L({ th: 'ใบรับรองอิเล็กทรอนิกส์', en: 'Electronic certificate' })}</h2>
        <p class="tut-cert-hint">${L({ th: 'ใส่ชื่อของคุณให้ปรากฏบนใบรับรอง', en: 'Enter the name to appear on the certificate' })}</p>
        <input type="text" id="certNameInput" class="tut-cert-input" maxlength="60"
               placeholder="${L({ th: 'ชื่อ - นามสกุล', en: 'Full name' })}" value="${_esc(savedName)}">
        <button type="button" class="tut-nav-btn primary tut-cert-gen" data-action="tut-cert-gen">${L({ th: 'สร้างใบรับรอง', en: 'Generate certificate' })}</button>
        <div id="certPreviewWrap" class="tut-cert-preview" style="display:none;">
            <img id="certPreviewImg" alt="certificate" class="tut-cert-img">
            <button type="button" class="tut-nav-btn primary" data-action="tut-cert-download">${L({ th: 'ดาวน์โหลด PNG', en: 'Download PNG' })}</button>
        </div>
    </div>`;
}
function _initCertView(p) {
    // If a certificate already exists, render its preview immediately.
    if (p.cert && p.cert.name) { _drawCertificate(p.cert); _showCertPreview(); }
}
export function tutGenerateCert() {
    const nameEl = _tg('certNameInput');
    const name = (nameEl && nameEl.value.trim()) || '';
    if (!name) { nameEl && nameEl.focus(); return; }
    const p = loadTutProgress();
    const data = {
        name,
        id: _certId(p),
        at: (p.cert && p.cert.at) || Date.now(),
        score: (p.quiz && p.quiz.best) || 100,
    };
    p.cert = data;
    saveTutProgress(p);
    if (typeof gaTrack === 'function') gaTrack('tutorial_cert', {});
    _drawCertificate(data);
    _showCertPreview();
    updateTutProgressBadge();
}
function _showCertPreview() {
    const wrap = _tg('certPreviewWrap');
    const img = _tg('certPreviewImg');
    const canvas = _tg('certCanvas');
    if (wrap && img && canvas) {
        img.src = canvas.toDataURL('image/png');
        wrap.style.display = 'flex';
    }
}
export function tutDownloadCert() {
    const canvas = _tg('certCanvas');
    if (!canvas) return;
    canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'IEC-Certificate.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
    if (typeof gaTrack === 'function') gaTrack('tutorial_cert_download', {});
}

// Modern, minimal certificate drawn on the off-screen canvas (1600×1131).
function _drawCertificate(data) {
    const canvas = _tg('certCanvas');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const FONT = "'Inter','Noto Sans Thai','Segoe UI',sans-serif";
    const ink = '#14152a', sub = '#5b5f76', faint = '#9095ab';
    const g1 = '#6366f1', g2 = '#4f46e5';

    ctx.clearRect(0, 0, W, H);
    // Card
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    // Left accent gradient bar
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, g1); grad.addColorStop(1, g2);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 26, H);
    // Thin inner frame
    ctx.strokeStyle = '#eef0f6'; ctx.lineWidth = 2;
    ctx.strokeRect(60, 60, W - 120, H - 120);

    const x = 130;
    // Brand mark (rounded square) + name
    _roundRect(ctx, x, 120, 64, 64, 16); ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 20, 138, 24, 8);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { ctx.beginPath(); ctx.arc(x + 22 + c * 10, 158 + r * 12, 2.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = ink; ctx.font = `600 30px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText('Industrial Engineering Calculator', x + 84, 152);

    // Eyebrow
    ctx.fillStyle = g2; ctx.font = `700 26px ${FONT}`;
    ctx.fillText(_letterSpace('CERTIFICATE OF COMPLETION', 4), x, 300);
    // Name
    ctx.fillStyle = ink; ctx.font = `800 96px ${FONT}`; ctx.textBaseline = 'alphabetic';
    ctx.fillText(_fit(ctx, data.name, W - x - 520, 96, FONT, 800), x, 420);
    // underline accent
    ctx.fillStyle = grad; ctx.fillRect(x, 452, 220, 6);

    // Statement
    ctx.fillStyle = sub; ctx.font = `400 32px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.fillText(L({ th: 'ได้ผ่านการเรียนรู้และการทดสอบหลักสูตร', en: 'has successfully completed and passed' }), x, 540);
    ctx.fillStyle = ink; ctx.font = `600 38px ${FONT}`;
    ctx.fillText(_fit(ctx, L(COURSE_NAME), W - x - 200, 38, FONT, 600), x, 600);

    // Divider
    ctx.strokeStyle = '#eef0f6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 900); ctx.lineTo(W - 130, 900); ctx.stroke();

    // Footer meta (three columns)
    const meta = [
        [L({ th: 'วันที่', en: 'Date' }), _fmtDate(data.at)],
        [L({ th: 'คะแนน', en: 'Score' }), data.score + '%'],
        [L({ th: 'รหัสใบรับรอง', en: 'Certificate ID' }), data.id],
    ];
    meta.forEach((m, i) => {
        const mx = x + i * 380;
        ctx.fillStyle = faint; ctx.font = `600 22px ${FONT}`; ctx.textBaseline = 'alphabetic';
        ctx.fillText(_letterSpace(m[0].toUpperCase(), 2), mx, 960);
        ctx.fillStyle = ink; ctx.font = `600 30px ${FONT}`;
        ctx.fillText(m[1], mx, 1000);
    });

    // Right-side modern seal — concentric rings + check
    const cx = W - 250, cy = 380, R = 120;
    ctx.strokeStyle = grad; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#e0e7ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R - 22, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = g2; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 42, cy + 4); ctx.lineTo(cx - 12, cy + 34); ctx.lineTo(cx + 46, cy - 34); ctx.stroke();
    ctx.lineCap = 'butt';
}
function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
// Tracking (letter-spacing) is a Latin typographic device. Splitting on UTF-16
// code units and injecting hair-spaces between them detaches Thai/Lao vowels and
// tone marks from their base consonants (and Vietnamese diacritics from theirs),
// garbling the text — e.g. "วันที่" → "ว้ันก๊ี". So only space plain ASCII strings;
// return any string with non-Latin characters untouched.
function _letterSpace(s, px) {
    if (/[^\x00-\x7F]/.test(s)) return s;
    return s.split('').join(String.fromCharCode(8202).repeat(Math.max(1, Math.round(px / 3))));
}
function _fit(ctx, text, maxW, size, font, weight) {
    let s = size;
    ctx.font = `${weight} ${s}px ${font}`;
    while (ctx.measureText(text).width > maxW && s > 20) { s -= 2; ctx.font = `${weight} ${s}px ${font}`; }
    return text;
}
function _fmtDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ---- Settings card progress badge ----
export function updateTutProgressBadge() {
    const badge = _tg('tutProgressBadge');
    if (!badge) return;
    const p = loadTutProgress();
    if (p.cert && p.cert.name) { badge.textContent = '✓'; badge.className = 'tut-launch-badge done'; return; }
    const pct = _overallPct(p);
    badge.textContent = pct > 0 ? pct + '%' : '';
    badge.className = 'tut-launch-badge';
}

// Re-render the open tutorial when the language changes (called from script.js).
export function tutorialOnLangChange() {
    if (_tg('tutorialModal') && _tg('tutorialModal').style.display === 'flex') renderTutorial();
    updateTutProgressBadge();
}

// Re-render on Firestore snapshot changes (e.g. progress made on another
// device, or our own optimistic write ack'd back). Cheap when the tutorial
// isn't open — just a badge refresh.
subscribeTutorialChange(() => {
    updateTutProgressBadge();
    if (_tg('tutorialModal')?.style.display === 'flex') renderTutorial();
});

// Exports for tests (also used internally):
export { TUTORIAL_DATA, QUIZ_DATA, QUIZ_PASS_PCT, _letterSpace, _stepImgSrc };

// ============================================================
// GOOGLE FORMS CONFIG  (Task 0.4)
// ============================================================
const GFORM = {
    url:   'https://docs.google.com/forms/u/0/d/e/1FAIpQLSeK5EJHXXDH7wk9B9Y3tkEH_YN-pIgekLlzoVRdHNCNf4UaGw/formResponse',
    entry: {
        rating:  'entry.450855868',
        message: 'entry.1453433683',
        email:   'entry.32399215',
    }
};
const GFORM_ENABLED = true;

// ============================================================
// GOOGLE ANALYTICS 4 CONFIG
// ============================================================
// วิธีตั้งค่า:
//   1. ไปที่ https://analytics.google.com → สร้าง Account → Property (Web)
//   2. Copy Measurement ID (รูปแบบ G-XXXXXXXXXX)
//   3. วางค่าด้านล่าง แล้วเปลี่ยน GA4_ENABLED เป็น true
// ============================================================
const GA4_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // ← ใส่ ID จริงที่นี่
const GA4_ENABLED        = false;           // ← เปลี่ยนเป็น true หลังใส่ ID แล้ว

// ============================================================
// CONFIG
// ============================================================
const MAX_TRAINING_DAYS = 18;

// --- 1. Global State ---
let startTime;
let elapsedTime = 0;
let timerInterval;
let isRunning = false;
let currentLang = 'th';

// Session tracking flags (track each feature only once per session)
const _tracked = { quality: false, training: false };

// --- 2. Stopwatch Modal State ---
const sw = {
    running:  false,
    mode:     'lap',    // 'lap' | 'single'
    elapsed:  0,        // total elapsed ms
    startTs:  null,     // timestamp when last started
    lapStart: 0,        // elapsed ms at start of current lap
    laps:     [],       // [ms per completed lap]
    interval: null,
};

// Format ms → MM:SS.cs  (centiseconds)
function fmtSw(ms) {
    const t  = Math.max(0, Math.floor(ms / 1000));
    const m  = Math.floor(t / 60);
    const s  = t % 60;
    const cs = Math.floor((Math.abs(ms) % 1000) / 10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// resetTimer: called by resetForm() — clears time input fields only
function resetTimer() {
    ['totalMin', 'totalTime', 'totalCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    calculateAll();
}

// ---- Stopwatch Modal ----
function openStopwatchModal() {
    gaTrack('open_stopwatch');
    document.getElementById('swModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    swUpdateUI();
}

function closeStopwatchModal() {
    if (sw.running) {
        clearInterval(sw.interval);
        sw.running = false;
        sw.elapsed = Date.now() - sw.startTs;
    }
    document.getElementById('swModal').style.display = 'none';
    document.body.style.overflow = '';
}

function swSetMode(mode) {
    if (sw.elapsed > 0) return; // cannot change mode after timing has started
    sw.mode = mode;
    document.getElementById('swTabLap').classList.toggle('active', mode === 'lap');
    document.getElementById('swTabSingle').classList.toggle('active', mode === 'single');
    swUpdateUI();
}

function swStartStop() {
    if (!sw.running) {
        sw.running = true;
        sw.startTs = Date.now() - sw.elapsed;
        sw.interval = setInterval(swTick, 10);
    } else {
        sw.running = false;
        clearInterval(sw.interval);
        sw.elapsed = Date.now() - sw.startTs;
        swShowStats();
    }
    swUpdateUI();
}

function swLapOrReset() {
    if (sw.running) {
        // Record lap
        const lapMs = sw.elapsed - sw.lapStart;
        sw.laps.push(lapMs);
        sw.lapStart = sw.elapsed;
        // Show lap section on first lap
        const lapSec = document.getElementById('swLapSection');
        if (lapSec) lapSec.style.display = 'block';
        swRenderLaps();
    } else {
        // Reset everything
        clearInterval(sw.interval);
        Object.assign(sw, { running:false, elapsed:0, startTs:null, lapStart:0, laps:[], interval:null });
        const el = id => document.getElementById(id);
        if (el('swDisplay'))    el('swDisplay').innerText    = '00:00.00';
        if (el('swCurrentLap')) el('swCurrentLap').innerText = '';
        if (el('swLapList'))    el('swLapList').innerHTML    = '';
        if (el('swStatsPanel')) el('swStatsPanel').style.display = 'none';
        if (el('swLapSection')) el('swLapSection').style.display = 'none';
        if (el('swSavePanel'))  el('swSavePanel').style.display  = 'none';
        swUpdateUI();
    }
}

function swTick() {
    sw.elapsed = Date.now() - sw.startTs;
    const el = id => document.getElementById(id);
    if (el('swDisplay')) el('swDisplay').innerText = fmtSw(sw.elapsed);
    if (sw.mode === 'lap') {
        const lapTimeEl = el('swCurrentLapTime');
        if (lapTimeEl) lapTimeEl.innerText = fmtSw(sw.elapsed - sw.lapStart);
    }
}

function swUpdateUI() {
    const startBtn    = document.getElementById('swStartStopBtn');
    const lapResetBtn = document.getElementById('swLapResetBtn');
    if (!startBtn || !lapResetBtn) return;

    if (sw.running) {
        startBtn.textContent    = 'Stop';
        startBtn.className      = 'sw-modal-btn sw-btn-stop';
        lapResetBtn.disabled    = sw.mode === 'single';
        lapResetBtn.textContent = 'Lap';
        lapResetBtn.className   = 'sw-modal-btn sw-btn-secondary' + (sw.mode === 'single' ? ' sw-btn-disabled' : '');
    } else if (sw.elapsed > 0) {
        startBtn.textContent    = 'Start';
        startBtn.className      = 'sw-modal-btn sw-btn-start';
        lapResetBtn.disabled    = false;
        lapResetBtn.textContent = 'Reset';
        lapResetBtn.className   = 'sw-modal-btn sw-btn-secondary';
    } else {
        startBtn.textContent    = 'Start';
        startBtn.className      = 'sw-modal-btn sw-btn-start';
        lapResetBtn.disabled    = true;
        lapResetBtn.textContent = 'Lap';
        lapResetBtn.className   = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
    }
}

function swRenderLaps() {
    const list = document.getElementById('swLapList');
    if (!list || !sw.laps.length) return;

    const minT = Math.min(...sw.laps);
    const maxT = Math.max(...sw.laps);
    const minI = sw.laps.indexOf(minT);
    const maxI = sw.laps.indexOf(maxT);
    let   html = '';

    // Current running lap (top row)
    if (sw.running && sw.mode === 'lap') {
        html += `
        <div class="sw-lap-row sw-lap-current">
            <span>Lap ${sw.laps.length + 1}</span>
            <span id="swCurrentLapTime">${fmtSw(sw.elapsed - sw.lapStart)}</span>
        </div>`;
    }
    // Completed laps — newest first
    for (let i = sw.laps.length - 1; i >= 0; i--) {
        const cls = sw.laps.length > 1
            ? (i === minI ? 'sw-lap-fastest' : i === maxI ? 'sw-lap-slowest' : '')
            : '';
        html += `
        <div class="sw-lap-row ${cls}">
            <span>Lap ${i + 1}</span>
            <span>${fmtSw(sw.laps[i])}</span>
        </div>`;
    }
    list.innerHTML = html;
}

function swShowStats() {
    const data = sw.mode === 'lap' ? sw.laps : (sw.elapsed > 0 ? [sw.elapsed] : []);
    if (!data.length) return;

    const total = data.reduce((a, b) => a + b, 0);
    const avg   = total / data.length;
    const min   = Math.min(...data);
    const max   = Math.max(...data);
    const vari  = data.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / data.length;
    const std   = Math.sqrt(vari);

    const setEl = (id, ms) => { const el = document.getElementById(id); if (el) el.innerText = fmtSw(ms); };
    setEl('swStatAvg', avg);   setEl('swStatMin', min);
    setEl('swStatMax', max);   setEl('swStatStd', std);
    setEl('swStatTotal', total);

    const statsPanel  = document.getElementById('swStatsPanel');
    const lapSection  = document.getElementById('swLapSection');
    const savePanel   = document.getElementById('swSavePanel');
    const roundsRow   = document.getElementById('swRoundsRow');
    if (statsPanel) statsPanel.style.display = 'block';
    if (savePanel)  savePanel.style.display  = 'block';
    if (roundsRow)  roundsRow.style.display  = sw.mode === 'single' ? 'flex' : 'none';
    if (lapSection && sw.mode === 'lap' && sw.laps.length > 0)
        lapSection.style.display = 'block';

    // Re-render laps with highlights after stopping
    if (sw.mode === 'lap' && sw.laps.length) swRenderLaps();
}

function swSaveToForm() {
    gaTrack('save_stopwatch', { mode: sw.mode, laps: sw.laps.length });
    let totalMs, rounds;
    if (sw.mode === 'lap') {
        totalMs = sw.laps.reduce((a, b) => a + b, 0);
        rounds  = sw.laps.length;
    } else {
        totalMs = sw.elapsed;
        rounds  = parseInt(document.getElementById('swRoundsInput')?.value) || 1;
    }
    const totalSec = Math.floor(totalMs / 1000);
    const g = id => document.getElementById(id);
    if (g('totalMin'))   g('totalMin').value   = Math.floor(totalSec / 60);
    if (g('totalTime'))  g('totalTime').value  = totalSec % 60;
    if (g('totalCount')) g('totalCount').value = rounds;
    calculateAll();
    closeStopwatchModal();
}

// ---- Export / Print ----
function printReport() {
    gaTrack('print_report');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const display = `${dateStr} ${timeStr}`;

    // Show print date on report
    const el = document.getElementById('printDate');
    if (el) el.textContent = `CSA Evaluation · ${display}`;

    // Set document title = PDF filename
    const orig = document.title;
    document.title = `CSA Evaluation - ${dateStr} ${timeStr.replace(':', '-')}`;
    window.print();
    document.title = orig;
}

// --- 3. Translations ---
const translations = {
    'th': {
        'brand_sub': 'เครื่องมือประเมินประสิทธิภาพ',
        'header1': 'การตั้งเป้าหมาย',
        'sam_label': 'ค่า SAM (นาที)',
        'eff_target': 'เป้าหมายประสิทธิภาพ (%)',
        'qty_label': 'เป้าหมายชิ้นงาน (ชิ้น/ชม.)',

        'header2': 'บันทึกผลงานจริง',
        'total_min': 'เวลารวม (นาที)',
        'total_sec': 'เวลารวม (วินาที)',
        'total_count': 'จำนวน (รอบ)',
        'avg_timesec': 'เวลาต่อรอบ (วินาที)',
        'avg_timemin': 'เวลาต่อรอบ (นาที)',
        'actual_eff': 'ประสิทธิภาพจริง (%)',
        'actual_pcs': 'ประสิทธิภาพจริง (ชิ้น/ชม.)',

        'header3': 'คุณภาพ',
        'pass_qty': 'จำนวนที่ "ผ่าน" (ชิ้น)',
        'fail_qty': 'จำนวนที่ "ไม่ผ่าน" (ชิ้น)',
        'pass_rate': 'อัตราการผ่าน (%)',

        'header4': 'วางแผนการฝึก',
        'training_duration': 'ระยะเวลาการฝึก (วัน/ชม)',
        'day_unit': 'วัน/ชม.ที่',

        'feedback_btn': 'Feedback',
        'feedback_title': 'ส่งความคิดเห็น',
        'feedback_subtitle': 'เรายินดีรับฟังความคิดเห็นของคุณ',
        'feedback_rating': 'ระดับความพึงพอใจ',
        'feedback_message': 'ข้อความเสนอแนะ',
        'feedback_contact': 'ข้อมูลติดต่อกลับ (ไม่บังคับ)',
        'cancel': 'ยกเลิก',
        'send': 'ส่งความคิดเห็น',
        'feedback_required': 'กรุณากรอกข้อความเสนอแนะ',
        'feedback_thanks': '✅ ขอบคุณสำหรับความคิดเห็น!',
        'sw_open': 'จับเวลา',
        'sw_open_sub': 'แตะเพื่อเปิดนาฬิกาจับเวลา',
        'sw_back': 'กลับ',
        'sw_stats': 'สถิติ',
        'sw_avg': 'เฉลี่ย',
        'sw_fastest': 'เร็วสุด',
        'sw_slowest': 'ช้าสุด',
        'sw_total': 'รวม',
        'sw_laps_title': 'รายการรอบ',
        'sw_rounds': 'จำนวนรอบ',
        'sw_save_form': 'บันทึกลงฟอร์ม',
    },
    'en': {
        'brand_sub': 'Performance Evaluation Tool',
        'header1': 'Set Target',
        'sam_label': 'SAM Value (Minutes)',
        'eff_target': 'Target Efficiency (%)',
        'qty_label': 'Target Cut Piece (pcs/hrs.)',

        'header2': 'Record Actual Results',
        'total_min': 'Total Time (Min)',
        'total_sec': 'Total Time (Sec)',
        'total_count': 'Count (Rounds)',
        'avg_timesec': 'Cycle Time (Sec)',
        'avg_timemin': 'Cycle Time (Min)',
        'actual_eff': 'Actual Efficiency (%)',
        'actual_pcs': 'Actual Efficiency (pcs/hr.)',

        'header3': 'Quality',
        'pass_qty': 'Passed Qty (Pcs)',
        'fail_qty': 'Failed Qty (Pcs)',
        'pass_rate': 'Pass Rate (%)',

        'header4': 'Training Plan',
        'training_duration': 'Training Duration (Days/Hrs)',
        'day_unit': 'Day/Hr.',

        'feedback_btn': 'Feedback',
        'feedback_title': 'Send Feedback',
        'feedback_subtitle': "We'd love to hear from you",
        'feedback_rating': 'Satisfaction Rating',
        'feedback_message': 'Suggestions',
        'feedback_contact': 'Contact Info (Optional)',
        'cancel': 'Cancel',
        'send': 'Send Feedback',
        'feedback_required': 'Please enter your feedback',
        'feedback_thanks': '✅ Thank you for your feedback!',
        'sw_open': 'Stopwatch',
        'sw_open_sub': 'Tap to open stopwatch',
        'sw_back': 'Back',
        'sw_stats': 'Statistics',
        'sw_avg': 'Average',
        'sw_fastest': 'Fastest',
        'sw_slowest': 'Slowest',
        'sw_total': 'Total',
        'sw_laps_title': 'Laps',
        'sw_rounds': 'Rounds',
        'sw_save_form': 'Save to Form',
    },
    'vn': {
        'brand_sub': 'Công cụ đánh giá hiệu suất',
        'header1': 'Thiết lập mục tiêu',
        'sam_label': 'Giá trị SAM (Phút)',
        'eff_target': 'Hiệu suất mục tiêu (%)',
        'qty_label': 'Số lượng sản phẩm mục tiêu mỗi giờ',

        'header2': 'Ghi lại kết quả thực tế',
        'total_min': 'Tổng thời gian (Phút)',
        'total_sec': 'Tổng thời gian (Giây)',
        'total_count': 'Số lần (Vòng)',
        'avg_timesec': 'Thời gian vòng (Giây)',
        'avg_timemin': 'Thời gian vòng (Phút)',
        'actual_eff': 'Hiệu suất thực tế (%)',
        'actual_pcs': 'Hiệu suất thực tế (SP/Giờ)',

        'header3': 'Chất lượng',
        'pass_qty': 'Số lượng đạt (Cái)',
        'fail_qty': 'Số lượng không đạt (Cái)',
        'pass_rate': 'Tỷ lệ đạt (%)',

        'header4': 'Kế hoạch đào tạo',
        'training_duration': 'Thời lượng đào tạo (ngày/giờ)',
        'day_unit': 'Ngày/Giờ',

        'feedback_btn': 'Phản hồi',
        'feedback_title': 'Gửi phản hồi',
        'feedback_subtitle': 'Chúng tôi rất vui được lắng nghe ý kiến của bạn',
        'feedback_rating': 'Mức độ hài lòng',
        'feedback_message': 'Đề xuất',
        'feedback_contact': 'Thông tin liên hệ (Không bắt buộc)',
        'cancel': 'Hủy',
        'send': 'Gửi phản hồi',
        'feedback_required': 'Vui lòng nhập phản hồi của bạn',
        'feedback_thanks': '✅ Cảm ơn phản hồi của bạn!',
        'sw_open': 'Bấm giờ',
        'sw_open_sub': 'Nhấn để mở đồng hồ bấm giờ',
        'sw_back': 'Trở lại',
        'sw_stats': 'Thống kê',
        'sw_avg': 'Trung bình',
        'sw_fastest': 'Nhanh nhất',
        'sw_slowest': 'Chậm nhất',
        'sw_total': 'Tổng',
        'sw_laps_title': 'Danh sách vòng',
        'sw_rounds': 'Số vòng',
        'sw_save_form': 'Lưu vào biểu mẫu',
    },
    'la': {
        'brand_sub': 'ເຄື່ອງມືປະເມີນປະສິດທິພາບ',
        'header1': 'ການກຳນົດເປົ້າໝາຍ',
        'sam_label': 'ຄ່າ SAM (ນາທີ)',
        'eff_target': 'ເປົ້າໝາຍການປະຕິບັດ (%)',
        'qty_label': 'ຈຳນວນເປົ້າໝາຍຂອງຊິ້ນສ່ວນຕໍ່ຊົ່ວໂມງ',

        'header2': 'ບັນທຶກຜົນໄດ້ຮັບຕົວຈິງ',
        'total_min': 'ເວລາທັງໝົດ (ນາທີ)',
        'total_sec': 'ເວລາທັງໝົດ (ວິນາທີ)',
        'total_count': 'ຈຳນວນເທື່ອ (ຮອບ)',
        'avg_timesec': 'ເວລາຮອບ (ວິນາທີ)',
        'avg_timemin': 'ເວລາຮອບ (ນາທີ)',
        'actual_eff': 'ປະສິດທິພາບຕົວຈິງ (%)',
        'actual_pcs': 'ປະສິດທິພາບຕົວຈິງ (ຊິ້ນ/ຊມ.)',

        'header3': 'ຄຸນນະພາບ',
        'pass_qty': 'ຈຳນວນທີ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'fail_qty': 'ຈຳນວນທີ່ບໍ່ໄດ້ມາດຕະຖານ (ຊິ້ນ)',
        'pass_rate': 'ອັດຕາການຜ່ານ (%)',

        'header4': 'ແຜນການຝຶກອົບຮົມ',
        'training_duration': 'ໄລຍະເວລາການຝຶກ (ມື້/ຊມ)',
        'day_unit': 'ມື້/ຊມ.',

        'feedback_btn': 'ຄໍາຄິດເຫັນ',
        'feedback_title': 'ສົ່ງຄໍາຄິດເຫັນ',
        'feedback_subtitle': 'ພວກເຮົາຍິນດີຮັບຟັງຄໍາຄິດເຫັນຂອງທ່ານ',
        'feedback_rating': 'ລະດັບຄວາມພໍໃຈ',
        'feedback_message': 'ຂໍ້ສະເໜີ',
        'feedback_contact': 'ຂໍ້ມູນຕິດຕໍ່ (ບໍ່ບັງຄັບ)',
        'cancel': 'ຍົກເລີກ',
        'send': 'ສົ່ງຄໍາຄິດເຫັນ',
        'feedback_required': 'ກະລຸນາໃສ່ຄໍາຄິດເຫັນ',
        'feedback_thanks': '✅ ຂອບໃຈສຳລັບຄໍາຄິດເຫັນ!',
        'sw_open': 'ຈັບເວລາ',
        'sw_open_sub': 'ແຕະເພື່ອເປີດໂມງຈັບເວລາ',
        'sw_back': 'ກັບ',
        'sw_stats': 'ສະຖິຕິ',
        'sw_avg': 'ສະເລ່ຍ',
        'sw_fastest': 'ໄວທີ່ສຸດ',
        'sw_slowest': 'ຊ້າທີ່ສຸດ',
        'sw_total': 'ລວມ',
        'sw_laps_title': 'ລາຍການຮອບ',
        'sw_rounds': 'ຈຳນວນຮອບ',
        'sw_save_form': 'ບັນທຶກລົງຟອມ',
    }
};

const LANG_META = {
    th: { flag: '🇹🇭', name: 'ไทย' },
    en: { flag: '🇺🇸', name: 'English' },
    vn: { flag: '🇻🇳', name: 'Tiếng Việt' },
    la: { flag: '🇱🇦', name: 'ລາວ' },
};

const pcsUnit  = { th: 'ชิ้น', en: 'pcs', vn: 'cái', la: 'ຊິ້ນ' };
const pcsPerHr = { th: 'ชิ้น/ชม.', en: 'pcs/hr', vn: 'SP/giờ', la: 'ຊິ້ນ/ຊມ' };

let chartMode   = 'pcs'; // 'pcs' | 'eff'
let _chartCache = { data: [], targetPcs: 0, effTarget: 0 };

const t = key => translations[currentLang]?.[key] ?? translations.th[key] ?? key;

// --- 4. Training Grid: generated dynamically inside calculateAll() ---

// --- 5. Language ---
function changeLanguage(lang) {
    if (!translations[lang]) return;
    gaTrack('change_language', { language: lang });
    currentLang = lang;
    document.documentElement.lang = lang;

    // body content
    document.querySelectorAll('.lang-text').forEach(el => {
        const key = el.getAttribute('data-key');
        if (translations[lang][key]) el.innerText = translations[lang][key];
    });

    // training day labels (generated dynamically)
    document.querySelectorAll('.day-label').forEach((el, idx) => {
        el.innerText = `${t('day_unit')} ${idx + 1}`;
    });

    // dropdown trigger + active state
    document.getElementById('currentFlag').innerText = LANG_META[lang].flag;
    document.getElementById('currentLangName').innerText = LANG_META[lang].name;
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === lang);
    });

    closeLangMenu();
    calculateAll(); // refresh pcs unit
}

function toggleLangMenu() {
    const sel = document.getElementById('langSelector');
    const open = sel.classList.toggle('open');
    document.getElementById('langTrigger').setAttribute('aria-expanded', open);
}
function closeLangMenu() {
    const sel = document.getElementById('langSelector');
    sel?.classList.remove('open');
    document.getElementById('langTrigger')?.setAttribute('aria-expanded', 'false');
}

function resetForm() {
    ['samInput','effTargetInput','passQty','failQty','duration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    resetTimer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 6. Core Calculation ---
function calculateAll() {
    const getValue = id => parseFloat(document.getElementById(id).value) || 0;

    const sam        = getValue('samInput');
    const effTarget  = getValue('effTargetInput');
    const totalMin   = getValue('totalMin');
    const totalTime  = getValue('totalTime');
    const totalCount = getValue('totalCount');
    const passQty    = getValue('passQty');
    const failQty    = getValue('failQty');
    const duration   = getValue('duration');

    // 1. Target
    const targetDisplay = document.getElementById('targetDisplay');
    targetDisplay.value = (sam > 0 && effTarget > 0)
        ? Math.ceil((60 / sam) * (effTarget / 100))
        : "";

    // 2. Actual
    let currentActualEff = 0;
    if (totalCount > 0 && (totalMin > 0 || totalTime > 0)) {
        const avgMin = ((totalMin * 60) + totalTime) / totalCount / 60;
        document.getElementById('avgTimeSec').value = Math.ceil(avgMin * 60);
        document.getElementById('avgTimeMin').value = avgMin.toFixed(2);
        if (sam > 0) {
            currentActualEff = Math.ceil((sam / avgMin) * 100);
            document.getElementById('actualEffPerc').value = `${currentActualEff} %`;
            document.getElementById('actualPcs').value = `${Math.ceil(60 / avgMin)} ${pcsPerHr[currentLang] || 'pcs/hr'}`;
        } else {
            document.getElementById('actualEffPerc').value = '';
            document.getElementById('actualPcs').value = '';
        }
    } else {
        ['avgTimeSec','avgTimeMin','actualEffPerc','actualPcs'].forEach(id => {
            document.getElementById(id).value = '';
        });
    }

    // 3. Quality
    const totalQty = passQty + failQty;
    document.getElementById('passRate').value =
        totalQty > 0 ? `${Math.ceil((passQty / totalQty) * 100)} %` : "";
    if (!_tracked.quality && totalQty > 0) {
        _tracked.quality = true;
        gaTrack('use_quality_section');
    }

    // 4. Training Plan — dynamic cards + learning curve chart
    const gap    = effTarget - currentActualEff;
    const tGrid  = document.getElementById('trainingGrid');
    const tChart = document.getElementById('learningChart');

    if (tGrid) {
        if (duration > 0 && gap > 0) {
            if (!_tracked.training) {
                _tracked.training = true;
                gaTrack('use_training_plan', { days: Math.min(duration, MAX_TRAINING_DAYS)|0 });
            }
            const days      = Math.min(duration, MAX_TRAINING_DAYS);
            const chartData = [];
            let   cardsHtml = '';

            for (let i = 1; i <= days; i++) {
                const dayEff = Math.ceil(currentActualEff + (gap / duration * i));
                const dayPcs = sam > 0 ? Math.ceil((60 / sam) * (dayEff / 100)) : 0;
                chartData.push({ day: i, eff: dayEff, pcs: dayPcs });
                cardsHtml += `
                <div class="day-card filled">
                    <label class="day-label">${t('day_unit')} ${i}</label>
                    <div class="day-card-body">
                        <span class="day-eff">${dayEff}%</span>
                        <span class="day-pcs">${dayPcs} ${pcsPerHr[currentLang] || 'pcs/hr'}</span>
                    </div>
                </div>`;
            }

            tGrid.innerHTML = cardsHtml;

            _chartCache = {
                data:       chartData,
                targetPcs:  sam > 0 ? Math.ceil((60 / sam) * (effTarget / 100)) : 0,
                effTarget,
                currentEff: currentActualEff,
                currentPcs: (sam > 0 && currentActualEff > 0)
                    ? Math.ceil((60 / sam) * (currentActualEff / 100)) : 0,
            };
            renderChartFromCache();
        } else {
            tGrid.innerHTML = '';
            _chartCache = { data: [], targetPcs: 0, effTarget: 0 };
            if (tChart) tChart.style.display = 'none';
        }
    }
}

// --- 7. Learning Curve Chart ---
function setChartMode(mode) {
    chartMode = mode;
    renderChartFromCache();
}

function renderChartFromCache() {
    const tChart = document.getElementById('learningChart');
    if (!tChart) return;
    if (!_chartCache.data.length) { tChart.style.display = 'none'; return; }

    tChart.style.display = 'block';
    const { data, targetPcs, effTarget, currentEff, currentPcs } = _chartCache;
    const isPcs    = chartMode === 'pcs' && targetPcs > 0;
    const day0Val  = isPcs ? (currentPcs || 0) : (currentEff || 0);
    const baseVals = data.map(d => ({ day: d.day, value: isPcs ? d.pcs : d.eff }));
    const values   = day0Val > 0
        ? [{ day: 0, value: day0Val, isDay0: true }, ...baseVals]
        : baseVals;
    const target   = isPcs ? targetPcs : effTarget;
    const unit     = isPcs ? (pcsPerHr[currentLang] || 'pcs/hr') : '%';
    const pcsLabel = pcsPerHr[currentLang] || 'pcs/hr';
    const hasPcs   = targetPcs > 0;

    tChart.innerHTML = `
    <div class="chart-header">
        <div class="chart-toggle-group">
            <button class="chart-toggle-btn ${isPcs ? 'active' : ''} ${!hasPcs ? 'disabled' : ''}"
                    onclick="setChartMode('pcs')" ${!hasPcs ? 'disabled' : ''}>${pcsLabel}</button>
            <button class="chart-toggle-btn ${!isPcs ? 'active' : ''}"
                    onclick="setChartMode('eff')">Eff %</button>
        </div>
    </div>
    ${renderSVGChart(values, target, unit)}`;
}

function renderSVGChart(values, target, unit) {
    const n = values.length;
    if (n === 0) return '';

    const W = 400, H = 180;
    const p = { t: 20, r: 36, b: 36, l: 42 };
    const cw = W - p.l - p.r;
    const ch = H - p.t - p.b;

    const maxY = Math.max(target * 1.2, ...values.map(d => d.value), 1);
    const x    = i => p.l + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
    const y    = v => p.t + ch - (v / maxY) * ch;

    // Y-axis grid + labels
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
        const v = Math.round(maxY * f), yv = y(v);
        return `<line x1="${p.l}" y1="${yv}" x2="${p.l+cw}" y2="${yv}"
                      stroke="var(--border)" stroke-width="1"/>
                <text x="${p.l-5}" y="${yv+4}" font-size="10" text-anchor="end"
                      fill="var(--text-3)" font-family="var(--font)">${v}</text>`;
    }).join('');

    // Target line
    const ty          = y(target);
    const targetLabel = unit === '%' ? `${target}%` : `${target} ${unit}`;
    const targetSvg   = target > 0 ? `
        <line x1="${p.l}" y1="${ty}" x2="${p.l+cw}" y2="${ty}"
              stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="5,3"/>
        <text x="${p.l+cw}" y="${ty-5}" font-size="10" text-anchor="end"
              fill="var(--danger)" font-family="var(--font)" font-weight="600">${targetLabel}</text>` : '';

    // Area
    const areaPath = [`M ${x(0)} ${p.t+ch}`,
        ...values.map((d, i) => `L ${x(i)} ${y(d.value)}`),
        `L ${x(n-1)} ${p.t+ch} Z`].join(' ');
    const area = `<path d="${areaPath}" fill="var(--accent-500)" opacity="0.12"/>`;

    // Line
    const linePath = values.map((d, i) => `${i===0?'M':'L'} ${x(i)} ${y(d.value)}`).join(' ');
    const line = `<path d="${linePath}" fill="none" stroke="var(--accent-500)"
                       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    // Dots (day 0 = current state, styled in warning/orange)
    const dots = values.map((d, i) => {
        if (d.isDay0) {
            const lbl = unit === '%' ? `${d.value}%` : `${d.value}`;
            return `
                <circle cx="${x(i)}" cy="${y(d.value)}" r="5"
                         fill="var(--warning)" stroke="var(--surface)" stroke-width="2.5"/>
                <text x="${x(i)+6}" y="${y(d.value)+10}" font-size="9" text-anchor="start"
                      fill="var(--warning)" font-family="var(--font)" font-weight="700">${lbl}</text>`;
        }
        return `<circle cx="${x(i)}" cy="${y(d.value)}" r="4"
                         fill="var(--accent-500)" stroke="var(--surface)" stroke-width="2"/>`;
    }).join('');

    // X labels — แสดงทุกหน่วย (1, 2, 3, ...)
    const xLabels = values.map((d, i) =>
        `<text x="${x(i)}" y="${p.t+ch+10}" font-size="10" text-anchor="middle"
               fill="var(--text-3)" font-family="var(--font)">${d.day}</text>`
    ).join('');

    // Axes
    const axes = `
        <line x1="${p.l}" y1="${p.t}" x2="${p.l}" y2="${p.t+ch}"
              stroke="var(--border-strong)" stroke-width="1.5"/>
        <line x1="${p.l}" y1="${p.t+ch}" x2="${p.l+cw}" y2="${p.t+ch}"
              stroke="var(--border-strong)" stroke-width="1.5"/>`;

    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">
        ${yTicks}${area}${targetSvg}${line}${dots}${axes}${xLabels}
    </svg>`;
}

// --- 8. Google Forms Integration ---
async function sendToGoogleForms(rating, message, email) {
    const body = new URLSearchParams({
        [GFORM.entry.rating]:  String(rating || '-'),
        [GFORM.entry.message]: message,
        [GFORM.entry.email]:   email || '-',
    });
    await fetch(GFORM.url, { method: 'POST', mode: 'no-cors', body });
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- 8. Feedback Modal ---
const feedbackModal     = document.getElementById('feedbackModal');
const feedbackBtn       = document.getElementById('feedbackBtn');
const closeModalBtn     = document.getElementById('closeModalBtn');
const cancelFeedbackBtn = document.getElementById('cancelFeedbackBtn');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');

let currentRating = 0;
const stars = document.querySelectorAll('.star');

stars.forEach(star => {
    star.addEventListener('click', () => {
        currentRating = parseInt(star.dataset.rating);
        document.getElementById('ratingValue').value = currentRating;
        stars.forEach((s, i) => s.classList.toggle('active', i < currentRating));
    });
});

function openFeedbackModal() {
    feedbackModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}
function closeFeedbackModal() {
    feedbackModal.style.display = 'none';
    document.body.style.overflow = '';
    resetFormFeedback();
}
function resetFormFeedback() {
    currentRating = 0;
    stars.forEach(s => s.classList.remove('active'));
    document.getElementById('ratingValue').value  = '';
    document.getElementById('feedbackMessage').value = '';
    document.getElementById('feedbackEmail').value   = '';
}

async function submitFeedback() {
    const rating  = document.getElementById('ratingValue').value;
    const message = document.getElementById('feedbackMessage').value.trim();
    const email   = document.getElementById('feedbackEmail').value.trim();

    if (!message) { alert(t('feedback_required')); return; }

    submitFeedbackBtn.disabled = true;
    submitFeedbackBtn.style.opacity = '0.6';
    const sendLabel = submitFeedbackBtn.querySelector('.lang-text');
    const originalText = sendLabel.innerText;
    sendLabel.innerText = '...';

    if (GFORM_ENABLED) {
        try { await sendToGoogleForms(rating, message, email); }
        catch (_) { /* no-cors: verify ไม่ได้ ถือว่าส่งแล้ว */ }
    }

    closeFeedbackModal();
    showToast(t('feedback_thanks'));

    submitFeedbackBtn.disabled = false;
    submitFeedbackBtn.style.opacity = '';
    sendLabel.innerText = originalText;
}

// --- 9. Event Wiring ---
feedbackBtn?.addEventListener('click', openFeedbackModal);
closeModalBtn?.addEventListener('click', closeFeedbackModal);
cancelFeedbackBtn?.addEventListener('click', closeFeedbackModal);
submitFeedbackBtn?.addEventListener('click', submitFeedback);

feedbackModal?.addEventListener('click', e => {
    if (e.target === feedbackModal) closeFeedbackModal();
});

document.getElementById('langTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleLangMenu();
});
document.querySelectorAll('.lang-option').forEach(opt => {
    opt.addEventListener('click', () => changeLanguage(opt.dataset.lang));
});
document.addEventListener('click', e => {
    if (!e.target.closest('#langSelector')) closeLangMenu();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (feedbackModal?.style.display === 'flex') closeFeedbackModal();
        closeLangMenu();
    }
});

// --- 10. Google Analytics 4 ---
function gaTrack(eventName, params = {}) {
    if (!GA4_ENABLED || typeof gtag === 'undefined') return;
    gtag('event', eventName, params);
}

function initGA4() {
    if (!GA4_ENABLED || !GA4_MEASUREMENT_ID || GA4_MEASUREMENT_ID === 'G-XXXXXXXXXX') return;

    // Inject GA4 script dynamically (non-blocking)
    const s = document.createElement('script');
    s.async = true;
    s.src   = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
    document.head.appendChild(s);

    // Init dataLayer
    window.dataLayer = window.dataLayer || [];
    window.gtag      = function(){ window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA4_MEASUREMENT_ID, { send_page_view: true });
}

// --- 11. Async Web Fonts (non-blocking; system font shows instantly) ---
function loadWebFonts() {
    const href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Thai:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Lao:wght@400;500;600;700&display=swap';
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

// --- 11. Init ---

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
}

initGA4(); // Google Analytics 4
changeLanguage('th');
calculateAll();
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

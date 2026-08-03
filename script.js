// ============================================================
// GOOGLE FORMS CONFIG
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
const GA4_MEASUREMENT_ID = 'G-9M9C6NZJ6Y';
const GA4_ENABLED        = true;

// ============================================================
// CONFIG
// ============================================================
const MAX_TRAINING_DAYS = 18;

// ============================================================
// PERSISTENCE (localStorage) — form auto-save + history
// ============================================================
const STORAGE_KEY_FORM    = 'csa_form_v1';
const STORAGE_KEY_HISTORY = 'csa_history_v1';
const STORAGE_KEY_THEME   = 'csa_theme';
const FORM_FIELD_IDS = ['samInput','effTargetInput','totalMin','totalTime','totalCount','passQty','failQty','duration'];
const HISTORY_MAX = 100;

// --- 1. Global State ---
let startTime;
let elapsedTime = 0;
let timerInterval;
let isRunning = false;
let currentLang = 'th';
let samUnit = 'min'; // unit the user types SAM in: 'min' or 'sec'

// Session tracking flags (track each feature only once per session)
const _tracked = { quality: false, training: false };

// --- 2. Stopwatch Modal State ---
const sw = {
    running:  false,
    paused:   false,    // true when frozen via Pause (not yet finalized)
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
    // Restore the initial defaults (matches the value="" attrs in index.html)
    // rather than blanking everything out.
    const defaults = { totalMin: '0', totalTime: '', totalCount: '1' };
    Object.entries(defaults).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
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
    if (!sw.running && !sw.paused) {
        // Start (or resume after a finalized Stop)
        sw.running = true;
        sw.startTs = Date.now() - sw.elapsed;
        sw.interval = setInterval(swTick, 10);
    } else {
        // Stop / finalize. If we got here from Pause, the clock is already
        // frozen; otherwise freeze it now.
        if (sw.running) {
            clearInterval(sw.interval);
            sw.elapsed = Date.now() - sw.startTs;
        }
        sw.running = false;
        sw.paused  = false;
        // In lap mode, Stop closes the in-progress lap so it counts as a
        // round too — e.g. Start → Lap ×3 → Stop yields 4 laps, not 3.
        if (sw.mode === 'lap' && sw.elapsed - sw.lapStart > 0) {
            sw.laps.push(sw.elapsed - sw.lapStart);
            sw.lapStart = sw.elapsed;
        }
        swShowStats();
    }
    swUpdateUI();
}

// Pause freezes the clock without ending the current lap or showing results;
// Resume continues the same lap from where it left off.
function swPauseResume() {
    if (sw.running) {
        // Pause
        clearInterval(sw.interval);
        sw.elapsed = Date.now() - sw.startTs;
        sw.running = false;
        sw.paused  = true;
        swRenderLaps();   // freeze the running-lap row at its paused value
    } else if (sw.paused) {
        // Resume — same lap, no split
        sw.running = true;
        sw.paused  = false;
        sw.startTs = Date.now() - sw.elapsed;
        sw.interval = setInterval(swTick, 10);
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
        Object.assign(sw, { running:false, paused:false, elapsed:0, startTs:null, lapStart:0, laps:[], interval:null });
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
    const pauseBtn    = document.getElementById('swPauseBtn');
    const lapResetBtn = document.getElementById('swLapResetBtn');
    if (!startBtn || !pauseBtn || !lapResetBtn) return;

    if (sw.running) {
        // Timing — right = Stop, middle = Pause, left = Lap
        startBtn.textContent    = t('sw_stop');
        startBtn.className       = 'sw-modal-btn sw-btn-stop';
        pauseBtn.disabled       = false;
        pauseBtn.textContent    = t('sw_pause');
        pauseBtn.className       = 'sw-modal-btn sw-btn-secondary';
        lapResetBtn.disabled    = sw.mode === 'single';
        lapResetBtn.textContent = t('sw_lap');
        lapResetBtn.className    = 'sw-modal-btn sw-btn-secondary' + (sw.mode === 'single' ? ' sw-btn-disabled' : '');
    } else if (sw.paused) {
        // Frozen mid-run — right = Stop (finalize), middle = Resume, left = Lap (off)
        startBtn.textContent    = t('sw_stop');
        startBtn.className       = 'sw-modal-btn sw-btn-stop';
        pauseBtn.disabled       = false;
        pauseBtn.textContent    = t('sw_resume');
        pauseBtn.className       = 'sw-modal-btn sw-btn-start';
        lapResetBtn.disabled    = true;
        lapResetBtn.textContent = t('sw_lap');
        lapResetBtn.className    = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
    } else if (sw.elapsed > 0) {
        // Finalized — right = Start (resume), middle = Pause (off), left = Reset
        startBtn.textContent    = t('sw_start');
        startBtn.className       = 'sw-modal-btn sw-btn-start';
        pauseBtn.disabled       = true;
        pauseBtn.textContent    = t('sw_pause');
        pauseBtn.className       = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
        lapResetBtn.disabled    = false;
        lapResetBtn.textContent = t('sw_reset');
        lapResetBtn.className    = 'sw-modal-btn sw-btn-secondary';
    } else {
        // Idle
        startBtn.textContent    = t('sw_start');
        startBtn.className       = 'sw-modal-btn sw-btn-start';
        pauseBtn.disabled       = true;
        pauseBtn.textContent    = t('sw_pause');
        pauseBtn.className       = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
        lapResetBtn.disabled    = true;
        lapResetBtn.textContent = t('sw_lap');
        lapResetBtn.className    = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
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

    // Current lap (top row) — shown while running or frozen while paused
    if ((sw.running || sw.paused) && sw.mode === 'lap') {
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

    // Start with all stat explanations collapsed
    document.querySelectorAll('.sw-stat-desc').forEach(d => d.classList.remove('sw-show'));
    document.querySelectorAll('.sw-stat-tappable').forEach(r => r.classList.remove('sw-open'));

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

// Close any open stat explanation (used by ESC, re-toggle, and fresh stats)
function swCloseStatInfo() {
    document.querySelectorAll('.sw-stat-desc.sw-show').forEach(d => d.classList.remove('sw-show'));
    document.querySelectorAll('.sw-stat-tappable.sw-open').forEach(r => r.classList.remove('sw-open'));
}

// Toggle the explanation panel under a tapped stat (accordion: one open at a time)
function swToggleStatInfo(key) {
    const desc = document.getElementById('swInfo_' + key);
    if (!desc) return;
    const willOpen = !desc.classList.contains('sw-show');
    swCloseStatInfo();
    if (willOpen) {
        desc.classList.add('sw-show');
        const row = desc.previousElementSibling;
        if (row) row.classList.add('sw-open');
        gaTrack('view_stat_info', { stat: key });
    }
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
    const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const display = `${dateStr} ${timeStr}`;
    
    // ตั้งชื่อไฟล์ (ระวังการใช้อักขระพิเศษในชื่อไฟล์ OS อาจจะไม่ยอมรับ)
    const filename = `CSA Evaluation - ${dateStr} ${timeStr.replace(':', '-')}`;

    const dateEl = document.getElementById('printDate');
    if (dateEl) dateEl.textContent = `CSA Evaluation · ${display}`;

    // 1. เก็บชื่อเดิม และตั้งชื่อใหม่
    const originalTitle = document.title;
    document.title = filename;

    // 2. สร้างฟังก์ชันทำความสะอาด (Cleanup Function)
    const restoreTitle = () => {
        document.title = originalTitle;
        // ทำลาย Event ทิ้งเมื่อใช้งานเสร็จ เพื่อป้องกัน Memory Leak
        window.removeEventListener('afterprint', restoreTitle); 
    };

    // 3. ผูก Event เข้ากับเบราว์เซอร์
    window.addEventListener('afterprint', restoreTitle);
    
    // 4. สั่ง Print
    window.print();
}

// --- 3. Translations ---
const translations = {
    'th': {
        'brand_sub': 'เครื่องมือประเมินประสิทธิภาพ',
        'header1': 'การตั้งเป้าหมาย',
        'sam_label': 'ค่า SAM (นาที)',
        'sam_label_base': 'ค่า SAM',
        'unit_min': 'นาที',
        'unit_sec': 'วินาที',
        'new_sam_label': 'ค่า SAM ใหม่ (เป้าหมาย)',
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
        'pass_qty': 'จำนวนที่ "ผ่าน"',
        'fail_qty': 'จำนวนที่ "ไม่ผ่าน"',
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
        'sw_start': 'เริ่ม',
        'sw_stop': 'หยุด',
        'sw_pause': 'พัก',
        'sw_resume': 'ต่อ',
        'sw_lap': 'รอบ',
        'sw_reset': 'รีเซ็ต',
        'sw_info_avg': 'เวลาเฉลี่ยต่อรอบ = เวลารวมทุกรอบ ÷ จำนวนรอบ',
        'sw_info_min': 'รอบที่ทำเวลาได้น้อยที่สุด (เร็วที่สุด)',
        'sw_info_max': 'รอบที่ใช้เวลามากที่สุด (ช้าที่สุด)',
        'sw_info_std': 'ส่วนเบี่ยงเบนมาตรฐาน บอกว่าเวลาแต่ละรอบกระจายห่างจากค่าเฉลี่ยแค่ไหน ยิ่งน้อยยิ่งสม่ำเสมอ = รากที่สองของค่าเฉลี่ยของ (เวลารอบ − ค่าเฉลี่ย)²',

        'history_title': 'ประวัติการประเมิน',
        'history_subtitle': 'บันทึกและเปรียบเทียบผลการประเมิน',
        'history_save': 'บันทึกปัจจุบัน',
        'history_label_placeholder': 'ชื่อ/ไลน์ (ไม่บังคับ)',
        'history_empty': 'ยังไม่มีประวัติที่บันทึกไว้',
        'history_compare': 'เปรียบเทียบ',
        'history_delete_confirm': 'ลบรายการนี้ออกจากประวัติ?',
        'compare_back': 'กลับ',
        'compare_gap': 'ส่วนต่างจากเป้าหมาย',
    },
    'en': {
        'brand_sub': 'Performance Evaluation Tool',
        'header1': 'Set Target',
        'sam_label': 'SAM Value (Minutes)',
        'sam_label_base': 'SAM Value',
        'unit_min': 'Min',
        'unit_sec': 'Sec',
        'new_sam_label': 'New SAM (Target)',
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
        'pass_qty': 'Passed Qty',
        'fail_qty': 'Failed Qty',
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
        'sw_start': 'Start',
        'sw_stop': 'Stop',
        'sw_pause': 'Pause',
        'sw_resume': 'Resume',
        'sw_lap': 'Lap',
        'sw_reset': 'Reset',
        'sw_info_avg': 'Average time per round = total time of all rounds ÷ number of rounds',
        'sw_info_min': 'The round with the shortest time (fastest)',
        'sw_info_max': 'The round with the longest time (slowest)',
        'sw_info_std': 'Standard deviation — how much each round varies from the average; lower means more consistent. = square root of the mean of (round time − average)²',

        'history_title': 'Evaluation History',
        'history_subtitle': 'Save and compare past evaluations',
        'history_save': 'Save Current',
        'history_label_placeholder': 'Name/Line (optional)',
        'history_empty': 'No saved history yet',
        'history_compare': 'Compare',
        'history_delete_confirm': 'Remove this entry from history?',
        'compare_back': 'Back',
        'compare_gap': 'Gap to Target',
    },
    'vn': {
        'brand_sub': 'Công cụ đánh giá hiệu suất',
        'header1': 'Thiết lập mục tiêu',
        'sam_label': 'Giá trị SAM (Phút)',
        'sam_label_base': 'Giá trị SAM',
        'unit_min': 'Phút',
        'unit_sec': 'Giây',
        'new_sam_label': 'SAM mới (Mục tiêu)',
        'eff_target': 'Hiệu suất mục tiêu (%)',
        'qty_label': 'Mục tiêu (SP/giờ)',

        'header2': 'Ghi lại kết quả thực tế',
        'total_min': 'Tổng thời gian (Phút)',
        'total_sec': 'Tổng thời gian (Giây)',
        'total_count': 'Số lần (Vòng)',
        'avg_timesec': 'Thời gian vòng (Giây)',
        'avg_timemin': 'Thời gian vòng (Phút)',
        'actual_eff': 'Hiệu suất thực tế (%)',
        'actual_pcs': 'Hiệu suất thực tế (SP/Giờ)',

        'header3': 'Chất lượng',
        'pass_qty': 'Số lượng đạt',
        'fail_qty': 'Số lượng không đạt',
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
        'sw_start': 'Bắt đầu',
        'sw_stop': 'Dừng',
        'sw_pause': 'Tạm dừng',
        'sw_resume': 'Tiếp tục',
        'sw_lap': 'Vòng',
        'sw_reset': 'Đặt lại',
        'sw_info_avg': 'Thời gian trung bình mỗi vòng = tổng thời gian các vòng ÷ số vòng',
        'sw_info_min': 'Vòng có thời gian ngắn nhất (nhanh nhất)',
        'sw_info_max': 'Vòng có thời gian dài nhất (chậm nhất)',
        'sw_info_std': 'Độ lệch chuẩn — cho biết thời gian mỗi vòng dao động quanh giá trị trung bình bao nhiêu; càng nhỏ càng ổn định. = căn bậc hai của trung bình (thời gian vòng − trung bình)²',

        'history_title': 'Lịch sử đánh giá',
        'history_subtitle': 'Lưu và so sánh các đánh giá trước đây',
        'history_save': 'Lưu hiện tại',
        'history_label_placeholder': 'Tên/Chuyền (không bắt buộc)',
        'history_empty': 'Chưa có lịch sử được lưu',
        'history_compare': 'So sánh',
        'history_delete_confirm': 'Xóa mục này khỏi lịch sử?',
        'compare_back': 'Trở lại',
        'compare_gap': 'Chênh lệch so với mục tiêu',
    },
    'la': {
        'brand_sub': 'ເຄື່ອງມືປະເມີນປະສິດທິພາບ',
        'header1': 'ການກຳນົດເປົ້າໝາຍ',
        'sam_label': 'ຄ່າ SAM (ນາທີ)',
        'sam_label_base': 'ຄ່າ SAM',
        'unit_min': 'ນາທີ',
        'unit_sec': 'ວິນາທີ',
        'new_sam_label': 'ຄ່າ SAM ໃໝ່ (ເປົ້າໝາຍ)',
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
        'sw_start': 'ເລີ່ມ',
        'sw_stop': 'ຢຸດ',
        'sw_pause': 'ພັກ',
        'sw_resume': 'ຕໍ່',
        'sw_lap': 'ຮອບ',
        'sw_reset': 'ຣີເຊັດ',
        'sw_info_avg': 'ເວລາເສລ່ຍຕໍ່ຮອບ = ເວລາລວມທຸກຮອບ ÷ ຈຳນວນຮອບ',
        'sw_info_min': 'ຮອບທີ່ໃຊ້ເວລາໜ້ອຍທີ່ສຸດ (ໄວທີ່ສຸດ)',
        'sw_info_max': 'ຮອບທີ່ໃຊ້ເວລາຫຼາຍທີ່ສຸດ (ຊ້າທີ່ສຸດ)',
        'sw_info_std': 'ສ່ວນບ່ຽງເບນມາດຕະຖານ ບອກວ່າເວລາແຕ່ລະຮອບກະຈາຍຫ່າງຈາກຄ່າເສລ່ຍເທົ່າໃດ ຍິ່ງໜ້ອຍຍິ່ງສະໝ່ຳສະເໝີ = ຮາກທີ່ສອງຂອງຄ່າເສລ່ຍຂອງ (ເວລາຮອບ − ຄ່າເສລ່ຍ)²',

        'history_title': 'ປະຫວັດການປະເມີນ',
        'history_subtitle': 'ບັນທຶກ ແລະ ປຽບທຽບຜົນການປະເມີນທີ່ຜ່ານມາ',
        'history_save': 'ບັນທຶກປັດຈຸບັນ',
        'history_label_placeholder': 'ຊື່/ໄລນ໌ (ບໍ່ບັງຄັບ)',
        'history_empty': 'ຍັງບໍ່ມີປະຫວັດທີ່ບັນທຶກໄວ້',
        'history_compare': 'ປຽບທຽບ',
        'history_delete_confirm': 'ລຶບລາຍການນີ້ອອກຈາກປະຫວັດ?',
        'compare_back': 'ກັບ',
        'compare_gap': 'ສ່ວນຕ່າງຈາກເປົ້າໝາຍ',
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

function setResultUnit(id, value, unit) {
    const el = document.getElementById(id);
    el.textContent = '';
    el.append(String(value));
    const u = document.createElement('span');
    u.className = 'result-unit';
    u.textContent = unit;
    el.append(u);
}

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

    // placeholder attributes
    document.querySelectorAll('[data-key-placeholder]').forEach(el => {
        const key = el.getAttribute('data-key-placeholder');
        if (translations[lang][key]) el.placeholder = translations[lang][key];
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
    swUpdateUI();
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
    setSamUnit('min', false);   // back to the default unit (no value conversion)
    resetTimer();               // restores totals + runs calculateAll()/save
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- 5b. Form Auto-save / Restore ---
function saveFormState() {
    try {
        const state = {};
        FORM_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) state[id] = el.value;
        });
        state.__samUnit = samUnit;
        localStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(state));
    } catch (_) { /* private browsing / quota exceeded — skip silently */ }
}

function restoreFormState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_FORM);
        if (!raw) return;
        const state = JSON.parse(raw);
        FORM_FIELD_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && state[id] !== undefined) el.value = state[id];
        });
        if (state.__samUnit === 'min' || state.__samUnit === 'sec') {
            samUnit = state.__samUnit;
        }
        updateSamUnitUI();
    } catch (_) { /* corrupt/unavailable storage — start fresh */ }
}

// --- 5c. History Storage ---
function loadHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

function persistHistory(list) {
    try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(list)); }
    catch (_) { /* private browsing / quota exceeded — skip silently */ }
}

function saveCurrentToHistory(label) {
    const getValue = id => parseFloat(document.getElementById(id).value) || 0;
    const inputs = {
        sam:        getSamMinutes(),
        effTarget:  getValue('effTargetInput'),
        totalMin:   getValue('totalMin'),
        totalTime:  getValue('totalTime'),
        totalCount: getValue('totalCount'),
        passQty:    getValue('passQty'),
        failQty:    getValue('failQty'),
        duration:   getValue('duration'),
    };
    const avgMin = calcAvgMin(inputs.totalMin, inputs.totalTime, inputs.totalCount);
    const computed = {
        targetPcs:  pcsFromEff(inputs.sam, inputs.effTarget),
        actualEff:  avgMin !== null ? calcActualEff(inputs.sam, avgMin) : null,
        actualPcs:  avgMin !== null ? calcActualPcsPerHr(avgMin) : null,
        passRate:   calcPassRate(inputs.passQty, inputs.failQty),
    };
    const entry = {
        id:    `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts:    Date.now(),
        label: (label || '').trim(),
        inputs,
        computed,
    };
    const list = loadHistory();
    list.unshift(entry);
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    persistHistory(list);
    gaTrack('save_history', { has_label: !!entry.label });
    return entry;
}

function deleteHistoryEntry(id) {
    const list = loadHistory().filter(e => e.id !== id);
    persistHistory(list);
    gaTrack('delete_history');
}

// --- 5d. SAM Unit (min / sec) ---
// Format a number for display: trim trailing zeros, cap at 4 decimals.
function trimNum(n) {
    return parseFloat(n.toFixed(4)).toString();
}

// SAM value in minutes, regardless of the unit the user is typing in.
function getSamMinutes() {
    const raw = parseFloat(document.getElementById('samInput').value) || 0;
    return samUnit === 'sec' ? raw / 60 : raw;
}

// Switch the SAM input between minutes and seconds. When `convert` is true
// (a user click) the typed value is converted so the underlying SAM is
// unchanged; on restore we pass false to keep the already-stored value.
function setSamUnit(unit, convert = true) {
    if (unit !== 'min' && unit !== 'sec') return;
    if (convert && unit !== samUnit) {
        const el  = document.getElementById('samInput');
        const raw = parseFloat(el.value);
        if (!isNaN(raw)) {
            el.value = trimNum(unit === 'sec' ? raw * 60 : raw / 60);
        }
    }
    samUnit = unit;
    updateSamUnitUI();
    if (convert) calculateAll();
}

function updateSamUnitUI() {
    const isSec = samUnit === 'sec';
    document.getElementById('samUnitBtnMin')?.classList.toggle('active', !isSec);
    document.getElementById('samUnitBtnSec')?.classList.toggle('active', isSec);
}

// --- 6. Core Calculation ---
function calculateAll() {
    const getValue = id => parseFloat(document.getElementById(id).value) || 0;

    const sam        = getSamMinutes();
    const effTarget  = getValue('effTargetInput');
    const totalMin   = getValue('totalMin');
    const totalTime  = getValue('totalTime');
    const totalCount = getValue('totalCount');
    const passQty    = getValue('passQty');
    const failQty    = getValue('failQty');
    const duration   = getValue('duration');

    // 1. Target
    const targetDisplay = document.getElementById('targetDisplay');
    const targetPcsVal  = pcsFromEff(sam, effTarget);
    if (targetPcsVal > 0) {
        setResultUnit('targetDisplay', targetPcsVal, pcsPerHr[currentLang] || 'pcs/hr');
    } else {
        targetDisplay.textContent = '';
    }

    // 1b. New SAM — target cycle time to reach the target efficiency,
    //     shown in whichever unit the SAM input is currently in.
    const newSamDisplay = document.getElementById('newSamDisplay');
    if (newSamDisplay) {
        const newSamMin = newSamFromEff(sam, effTarget);
        newSamDisplay.textContent = '';
        if (newSamMin !== null) {
            const val  = samUnit === 'sec' ? newSamMin * 60 : newSamMin;
            setResultUnit('newSamDisplay', val.toFixed(2), t(samUnit === 'sec' ? 'unit_sec' : 'unit_min'));
        }
    }

    // 2. Actual
    let currentActualEff = 0;
    const avgMin = calcAvgMin(totalMin, totalTime, totalCount);
    if (avgMin !== null) {
        setResultUnit('avgTimeSec', Math.ceil(avgMin * 60), t('unit_sec'));
        setResultUnit('avgTimeMin', avgMin.toFixed(2), t('unit_min'));
        const eff = calcActualEff(sam, avgMin);
        if (eff !== null) {
            currentActualEff = eff;
            document.getElementById('actualEffPerc').value = `${currentActualEff} %`;
            setResultUnit('actualPcs', calcActualPcsPerHr(avgMin), pcsPerHr[currentLang] || 'pcs/hr');
        } else {
            document.getElementById('actualEffPerc').value = '';
            document.getElementById('actualPcs').textContent = '';
        }
    } else {
        document.getElementById('actualEffPerc').value = '';
        ['avgTimeSec','avgTimeMin','actualPcs'].forEach(id => {
            document.getElementById(id).textContent = '';
        });
    }

    // 3. Quality
    const totalQty  = passQty + failQty;
    const passRate  = calcPassRate(passQty, failQty);
    document.getElementById('passRate').value = passRate !== null ? `${passRate} %` : "";
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
                const { eff: dayEff, pcs: dayPcs } = calcTrainingDay(currentActualEff, gap, duration, i, sam);
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
                targetPcs:  pcsFromEff(sam, effTarget),
                effTarget,
                currentEff: currentActualEff,
                currentPcs: pcsFromEff(sam, currentActualEff),
            };
            renderChartFromCache();
        } else {
            tGrid.innerHTML = '';
            _chartCache = { data: [], targetPcs: 0, effTarget: 0 };
            if (tChart) tChart.style.display = 'none';
        }
    }

    saveFormState();
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

    // Dots + hover tooltips
    const dots = values.map((d, i) => {
        const cx = x(i), cy = y(d.value);
        const lbl = unit === '%' ? `${d.value}%` : `${d.value} ${unit}`;
        const anchor = cx < p.l + cw / 2 ? 'start' : 'end';
        const tx = anchor === 'start' ? cx + 8 : cx - 8;
        const ty = cy - 10;
        if (d.isDay0) {
            return `
                <circle cx="${cx}" cy="${cy}" r="5"
                        fill="var(--warning)" stroke="var(--surface)" stroke-width="2.5"/>
                <text x="${cx+6}" y="${cy+10}" font-size="9" text-anchor="start"
                      fill="var(--warning)" font-family="var(--font)" font-weight="700">${lbl}</text>`;
        }
        return `<g class="chart-dot-group">
            <circle cx="${cx}" cy="${cy}" r="4"
                    fill="var(--accent-500)" stroke="var(--surface)" stroke-width="2"
                    class="chart-dot"/>
            <circle cx="${cx}" cy="${cy}" r="16" fill="transparent" class="chart-hit"/>
            <text x="${tx}" y="${ty}" font-size="9.5" text-anchor="${anchor}"
                  fill="var(--text-1)" font-family="var(--font)" font-weight="600"
                  class="chart-tip">${lbl}</text>
        </g>`;
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

// --- 8b. History / Compare Modal ---
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const historyModal        = document.getElementById('historyModal');
const closeHistoryBtn     = document.getElementById('closeHistoryBtn');
const historyCloseBtn     = document.getElementById('historyCloseBtn');
const historySaveBtn      = document.getElementById('historySaveBtn');
const historyLabelInput   = document.getElementById('historyLabelInput');
const historyListEl       = document.getElementById('historyList');
const historyEmptyMsg     = document.getElementById('historyEmptyMsg');
const historyCompareBtn   = document.getElementById('historyCompareBtn');
const historyListView     = document.getElementById('historyListView');
const historyCompareView  = document.getElementById('historyCompareView');
const historyListFooter   = document.getElementById('historyListFooter');
const historyCompareFooter= document.getElementById('historyCompareFooter');
const compareTableWrap    = document.getElementById('compareTableWrap');
const compareBackBtn      = document.getElementById('compareBackBtn');

let historySelected = new Set();

function fmtHistoryTs(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openHistoryModal() {
    gaTrack('open_history');
    renderHistoryList();
    showHistoryListView();
    historyModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeHistoryModal() {
    historyModal.style.display = 'none';
    document.body.style.overflow = '';
}

function showHistoryListView() {
    historyListView.style.display    = 'block';
    historyCompareView.style.display = 'none';
    historyListFooter.style.display    = 'flex';
    historyCompareFooter.style.display = 'none';
}

function showHistoryCompareView() {
    historyListView.style.display    = 'none';
    historyCompareView.style.display = 'block';
    historyListFooter.style.display    = 'none';
    historyCompareFooter.style.display = 'flex';
}

function historyRowHtml(e) {
    const { computed } = e;
    const title = e.label || fmtHistoryTs(e.ts);
    const metaParts = [];
    if (computed.actualEff !== null) metaParts.push(`${computed.actualEff}% eff`);
    if (computed.targetPcs > 0)      metaParts.push(`${computed.targetPcs} ${pcsPerHr[currentLang] || 'pcs/hr'}`);
    if (computed.passRate !== null)  metaParts.push(`${computed.passRate}% pass`);
    return `
    <div class="history-row" data-id="${e.id}">
        <label class="history-row-check">
            <input type="checkbox" class="history-check" value="${e.id}">
        </label>
        <div class="history-row-main">
            <div class="history-row-title">${escapeHtml(title)}</div>
            <div class="history-row-meta">${escapeHtml(metaParts.join(' · ') || '—')}</div>
        </div>
        <button type="button" class="history-delete-btn" data-id="${e.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
    </div>`;
}

function renderHistoryList() {
    const list = loadHistory();
    historyEmptyMsg.style.display = list.length ? 'none' : 'block';
    historyListEl.innerHTML = list.map(historyRowHtml).join('');

    historyListEl.querySelectorAll('.history-check').forEach(cb => {
        cb.checked = historySelected.has(cb.value);
        cb.addEventListener('change', () => {
            if (cb.checked) historySelected.add(cb.value); else historySelected.delete(cb.value);
            updateCompareButtonState();
        });
    });
    historyListEl.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm(t('history_delete_confirm'))) return;
            deleteHistoryEntry(btn.dataset.id);
            historySelected.delete(btn.dataset.id);
            renderHistoryList();
        });
    });
    updateCompareButtonState();
}

function updateCompareButtonState() {
    if (historyCompareBtn) historyCompareBtn.disabled = historySelected.size < 2;
}

function handleHistorySave() {
    saveCurrentToHistory(historyLabelInput.value);
    historyLabelInput.value = '';
    renderHistoryList();
}

function renderCompareTable() {
    const selected = loadHistory().filter(e => historySelected.has(e.id));
    if (selected.length < 2) return;

    const rows = [
        { key: 'sam_label',    get: e => e.inputs.sam > 0 ? e.inputs.sam : '—' },
        { key: 'eff_target',   get: e => e.inputs.effTarget > 0 ? `${e.inputs.effTarget}%` : '—' },
        { key: 'qty_label',    get: e => e.computed.targetPcs > 0 ? e.computed.targetPcs : '—' },
        { key: 'actual_eff',   get: e => e.computed.actualEff !== null ? `${e.computed.actualEff}%` : '—' },
        { key: 'actual_pcs',   get: e => e.computed.actualPcs !== null ? e.computed.actualPcs : '—' },
        { key: 'pass_rate',    get: e => e.computed.passRate !== null ? `${e.computed.passRate}%` : '—' },
        { key: 'compare_gap',  get: e => (e.computed.actualEff !== null && e.inputs.effTarget > 0)
                                          ? `${e.computed.actualEff - e.inputs.effTarget}%` : '—' },
    ];

    const headerCells = selected.map(e => `<th>${escapeHtml(e.label || fmtHistoryTs(e.ts))}</th>`).join('');
    const bodyRows = rows.map(r => `
        <tr><th scope="row">${t(r.key)}</th>${selected.map(e => `<td>${r.get(e)}</td>`).join('')}</tr>`).join('');

    compareTableWrap.innerHTML = `
        <table class="compare-table">
            <thead><tr><th></th>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>`;
}

function openCompareView() {
    if (historySelected.size < 2) return;
    gaTrack('compare_history', { count: historySelected.size });
    renderCompareTable();
    showHistoryCompareView();
}

// --- 8c. Theme Toggle ---
function getEffectiveTheme() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeIcon() {
    const isDark = getEffectiveTheme() === 'dark';
    const moon = document.getElementById('themeIconMoon');
    const sun  = document.getElementById('themeIconSun');
    if (moon) moon.style.display = isDark ? 'none'  : 'block';
    if (sun)  sun.style.display  = isDark ? 'block' : 'none';
}

function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    updateThemeIcon();
}

function toggleTheme() {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY_THEME, next); } catch (_) { /* skip silently */ }
    applyTheme(next);
    gaTrack('toggle_theme', { theme: next });
}

function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY_THEME); } catch (_) { /* skip silently */ }
    if (stored === 'light' || stored === 'dark') applyTheme(stored);
    else updateThemeIcon();

    // Keep the icon accurate if the OS theme changes while no explicit choice is set.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (!document.documentElement.dataset.theme) updateThemeIcon();
    });
}

// --- 9. Event Wiring ---
feedbackBtn?.addEventListener('click', openFeedbackModal);
closeModalBtn?.addEventListener('click', closeFeedbackModal);
cancelFeedbackBtn?.addEventListener('click', closeFeedbackModal);
submitFeedbackBtn?.addEventListener('click', submitFeedback);

feedbackModal?.addEventListener('click', e => {
    if (e.target === feedbackModal) closeFeedbackModal();
});

closeHistoryBtn?.addEventListener('click', closeHistoryModal);
historyCloseBtn?.addEventListener('click', closeHistoryModal);
historySaveBtn?.addEventListener('click', handleHistorySave);
historyCompareBtn?.addEventListener('click', openCompareView);
compareBackBtn?.addEventListener('click', showHistoryListView);
historyModal?.addEventListener('click', e => {
    if (e.target === historyModal) closeHistoryModal();
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
        if (historyModal?.style.display === 'flex') closeHistoryModal();
        const swModal = document.getElementById('swModal');
        if (swModal?.style.display === 'flex') {
            const hasOpenInfo = document.querySelector('.sw-stat-desc.sw-show');
            if (hasOpenInfo) swCloseStatInfo();
            else closeStopwatchModal();
        } else {
            swCloseStatInfo();
        }
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
initTheme();
restoreFormState();
changeLanguage('th');
calculateAll();
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

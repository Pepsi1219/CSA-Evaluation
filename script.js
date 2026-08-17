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

// Format ms → seconds with 2 decimals (for mean / general stats)
function fmtSec2(ms) {
    return (Math.abs(ms) / 1000).toFixed(2);
}
// Format ms → seconds with 4 decimals (for SD — needs finer precision)
function fmtSec4(ms) {
    return (Math.abs(ms) / 1000).toFixed(4);
}
// Snap raw ms to the display resolution (10 ms = 2-decimal seconds).
// Storing laps at this resolution guarantees stats calculated from stored
// values match what the user sees on screen and would hand-calc.
function snapLapMs(ms) { return Math.round(ms / 10) * 10; }

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
            sw.laps.push(snapLapMs(sw.elapsed - sw.lapStart));
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
        // Record lap — snap to 10 ms so stored value == displayed value
        const lapMs = snapLapMs(sw.elapsed - sw.lapStart);
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
        if (el('swStatsPanel'))  el('swStatsPanel').style.display  = 'none';
        if (el('swLapSection'))  el('swLapSection').style.display  = 'none';
        if (el('swSavePanel'))   el('swSavePanel').style.display   = 'none';
        if (el('swContinueBtn')) el('swContinueBtn').style.display = 'none';
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
    // Sample SD (n-1, Bessel's correction) — matches Time Study convention
    // and the t-distribution used in the sample-size calc below.
    const denom = data.length > 1 ? data.length - 1 : 1;
    const vari  = data.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / denom;
    const std   = Math.sqrt(vari);

    const setEl = (id, ms) => { const el = document.getElementById(id); if (el) el.innerText = fmtSw(ms); };
    setEl('swStatAvg', avg);   setEl('swStatMin', min);
    setEl('swStatMax', max);   setEl('swStatTotal', total);
    // Std Dev is a spread, not a clock time — display in seconds (statistical convention)
    const stdEl = document.getElementById('swStatStd');
    if (stdEl) stdEl.innerHTML = `${fmtSec4(std)}<span class="sw-stat-unit"> s</span>`;

    const statsPanel  = document.getElementById('swStatsPanel');
    const lapSection  = document.getElementById('swLapSection');
    const savePanel   = document.getElementById('swSavePanel');
    const roundsRow   = document.getElementById('swRoundsRow');
    if (statsPanel) statsPanel.style.display = 'block';
    if (savePanel)  savePanel.style.display  = 'block';
    if (roundsRow)  roundsRow.style.display  = sw.mode === 'single' ? 'flex' : 'none';
    if (lapSection && sw.mode === 'lap' && sw.laps.length > 0)
        lapSection.style.display = 'block';

    // Time Study — recompute the "required N" row (only meaningful in lap mode with 2+ laps)
    tsRecalculate();

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

// ---- Time Study (Statistical Sample Size) ----
// Two-tailed critical values from Student's t-distribution.
// Rows: [df, t@90%, t@95%, t@99%]. df>30 falls back to the last row.
const T_TABLE = [
    [1, 6.3138, 12.7062, 63.6567],
    [2, 2.9200,  4.3027,  9.9248],
    [3, 2.3534,  3.1824,  5.8409],
    [4, 2.1318,  2.7764,  4.6041],
    [5, 2.0150,  2.5706,  4.0321],
    [6, 1.9432,  2.4469,  3.7074],
    [7, 1.8946,  2.3646,  3.4995],
    [8, 1.8595,  2.3060,  3.3554],
    [9, 1.8331,  2.2622,  3.2498],
    [10, 1.8125, 2.2281, 3.1693],
    [11, 1.7959, 2.2010, 3.1058],
    [12, 1.7823, 2.1788, 3.0545],
    [13, 1.7709, 2.1604, 3.0123],
    [14, 1.7613, 2.1448, 2.9768],
    [15, 1.7531, 2.1314, 2.9467],
    [16, 1.7459, 2.1199, 2.9208],
    [17, 1.7396, 2.1098, 2.8982],
    [18, 1.7341, 2.1009, 2.8784],
    [19, 1.7291, 2.0930, 2.8609],
    [20, 1.7247, 2.0860, 2.8453],
    [21, 1.7207, 2.0796, 2.8314],
    [22, 1.7171, 2.0739, 2.8188],
    [23, 1.7139, 2.0687, 2.8073],
    [24, 1.7109, 2.0639, 2.7969],
    [25, 1.7081, 2.0595, 2.7874],
    [26, 1.7056, 2.0555, 2.7787],
    [27, 1.7033, 2.0518, 2.7707],
    [28, 1.7011, 2.0484, 2.7633],
    [29, 1.6991, 2.0452, 2.7564],
    [30, 1.6973, 2.0423, 2.7500],
];

const _ts = { confidence: 95, error: 5 };

function tsTValue(df, confidence) {
    if (df < 1) return null;
    const capped = Math.min(df, 30);
    const row = T_TABLE.find(r => r[0] === capped);
    const idx = confidence === 90 ? 1 : (confidence === 99 ? 3 : 2);
    return row ? row[idx] : null;
}

function tsSetConfidence(c) {
    _ts.confidence = c;
    document.querySelectorAll('.sw-ts-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.conf) === c);
    });
    tsRecalculate();
    gaTrack('ts_change_confidence', { confidence: c });
}

function tsRecalculate() {
    const errorInput = document.getElementById('tsErrorInput');
    let e = parseFloat(errorInput?.value);
    if (!isFinite(e) || e <= 0) e = 5;
    if (e > 50) e = 50;
    _ts.error = e;

    const reqnRow    = document.querySelector('.sw-stat.sw-stat-reqn');
    const reqnVal    = document.getElementById('swStatReqN');
    const reqnInfo   = document.getElementById('swInfo_reqn');
    const contBtn    = document.getElementById('swContinueBtn');
    if (!reqnVal || !reqnInfo) return;

    // Clear any prior verdict classes on the row
    if (reqnRow) reqnRow.classList.remove('sw-reqn-ok', 'sw-reqn-warn', 'sw-reqn-na');
    if (contBtn) contBtn.style.display = 'none';

    // Only lap mode with 2+ laps has a distribution to work with
    const data = sw.mode === 'lap' ? sw.laps : [];
    const n = data.length;

    if (n < 2) {
        if (reqnRow) reqnRow.classList.add('sw-reqn-na');
        reqnVal.innerHTML  = '<span class="sw-reqn-na-text lang-text" data-key="ts_na">—</span>';
        reqnInfo.innerHTML = `<span class="lang-text" data-key="ts_need_pilot">${t('ts_need_pilot')}</span>`;
        return;
    }

    const mean = data.reduce((a, b) => a + b, 0) / n;
    const variance = data.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
    const sd = Math.sqrt(variance);

    const df = n - 1;
    const tVal = tsTValue(df, _ts.confidence);
    const eRatio = _ts.error / 100;

    // N = ( (t * s) / (e * mean) )²
    const N_raw = mean > 0 ? Math.pow((tVal * sd) / (eRatio * mean), 2) : 0;
    const N = Math.ceil(N_raw);

    const isSufficient = n >= N;
    const needMore = Math.max(0, N - n);

    // Row value — just the number, matching other rows' style
    if (reqnRow) reqnRow.classList.add(isSufficient ? 'sw-reqn-ok' : 'sw-reqn-warn');
    reqnVal.innerHTML = `<span class="sw-reqn-num">${N}</span>`;

    // Continue-timing CTA only when insufficient
    if (contBtn && !isSufficient) {
        contBtn.style.display = 'flex';
        const label = t('ts_continue_btn').replace('{more}', needMore);
        const labelEl = document.getElementById('swContinueBtnLabel');
        if (labelEl) labelEl.textContent = label;
    }

    // Expanded explanation (revealed on tap of the row)
    const dfNote = df > 30 ? ` <span class="sw-ts-note">(${t('ts_capped_df')})</span>` : '';
    const eStr = eRatio.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const summaryLine = isSufficient
        ? t('ts_have_ok').replace('{n}', n)
        : t('ts_have_short').replace('{n}', n).replace('{more}', needMore);

    // Pretty math notation: N = ((t·s) / (e·x̄))²
    const formulaHTML = `
        <div class="mformula" aria-label="N equals open-paren t times s over e times x-bar close-paren squared">
            <span class="mvar">N</span>
            <span class="meq">=</span>
            <span class="mparen">(</span>
            <span class="mfrac">
                <span class="mnum"><i>t</i> · <i>s</i></span>
                <span class="mden"><i>e</i> · <i>x̄</i></span>
            </span>
            <span class="mparen">)</span>
            <span class="msup">2</span>
        </div>`;

    reqnInfo.innerHTML = `
        <div class="sw-reqn-headline">
            ${t('ts_msg_prefix')
                .replace('{conf}', _ts.confidence)
                .replace('{N_raw}', N_raw.toFixed(2))
                .replace('{N}', N)}
        </div>
        <div class="sw-reqn-summary">${summaryLine}</div>
        <div class="sw-ts-metrics">
            <div class="sw-ts-metric"><span>n</span><span>${n}</span></div>
            <div class="sw-ts-metric"><span>df</span><span>${df}${dfNote}</span></div>
            <div class="sw-ts-metric"><span>t</span><span>${tVal.toFixed(4)}</span></div>
            <div class="sw-ts-metric"><span>x̄</span><span>${fmtSec2(mean)} s</span></div>
            <div class="sw-ts-metric"><span>s</span><span>${fmtSec4(sd)} s</span></div>
            <div class="sw-ts-metric"><span>e</span><span>${eStr} <span class="sw-ts-note">(${_ts.error}%)</span></span></div>
            <div class="sw-ts-metric sw-ts-metric-hero">
                <span>N</span>
                <span>${N_raw.toFixed(2)} → <strong>${N}</strong></span>
            </div>
        </div>
        ${formulaHTML}`;
}

// Prepare stopwatch for more laps after Stop → preserves existing laps
// and elapsed time. Does NOT auto-start — the user presses Start themselves
// so they're ready when the clock begins.
function swContinueTiming() {
    gaTrack('sw_continue_timing', { laps_so_far: sw.laps.length });
    // Hide summary + save panels; keep controls visible so Start is reachable
    const el = id => document.getElementById(id);
    if (el('swStatsPanel'))    el('swStatsPanel').style.display    = 'none';
    if (el('swSavePanel'))     el('swSavePanel').style.display     = 'none';
    if (el('swContinueBtn'))   el('swContinueBtn').style.display   = 'none';
    swCloseStatInfo();
    swUpdateUI();  // ensure Start button is in the correct resumable state
}

function openTsConfigModal() {
    gaTrack('open_ts_config');
    renderTTable();
    const m = document.getElementById('tsConfigModal');
    if (m) m.style.display = 'flex';
}

function closeTsConfigModal() {
    const m = document.getElementById('tsConfigModal');
    if (m) m.style.display = 'none';
}

function renderTTable() {
    const tbody = document.getElementById('tTableBody');
    if (!tbody) return;
    const activeDf = sw.mode === 'lap' && sw.laps.length >= 2 ? Math.min(sw.laps.length - 1, 30) : null;
    const activeCol = _ts.confidence === 90 ? 1 : (_ts.confidence === 99 ? 3 : 2);
    tbody.innerHTML = T_TABLE.map(row => {
        const [df, t90, t95, t99] = row;
        const isActive = df === activeDf;
        return `<tr class="${isActive ? 'sw-ts-row-active' : ''}">
            <td>${df}</td><td>${df + 1}</td>
            <td class="${activeCol === 1 ? 'sw-ts-col-active' : ''}">${t90}</td>
            <td class="${activeCol === 2 ? 'sw-ts-col-active' : ''}">${t95}</td>
            <td class="${activeCol === 3 ? 'sw-ts-col-active' : ''}">${t99}</td>
        </tr>`;
    }).join('');
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
        'sw_summary': 'สรุปผล',
        'sw_avg': 'ค่าเฉลี่ย',
        'sw_fastest': 'เวลาเร็วสุด',
        'sw_slowest': 'เวลาช้าสุด',
        'sw_total': 'เวลารวม',
        'sw_std': 'ส่วนเบี่ยงเบนมาตรฐาน (s)',
        'sw_required_n': 'จำนวนรอบที่ควรจับเวลา',
        'sw_info_total': 'ผลรวมเวลาทุกรอบที่จับได้',
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
        'sw_info_std': 'ส่วนเบี่ยงเบนมาตรฐาน (Sample SD) บอกว่าเวลาแต่ละรอบกระจายห่างจากค่าเฉลี่ยแค่ไหน ยิ่งน้อยยิ่งสม่ำเสมอ = √( Σ(เวลารอบ − ค่าเฉลี่ย)² ÷ (n−1) ) — ใช้ n−1 ตามหลัก Bessel เพื่อให้คู่กับตาราง t ใน Time Study',

        'history_title': 'ประวัติการประเมิน',
        'history_subtitle': 'บันทึกและเปรียบเทียบผลการประเมิน',
        'history_save': 'บันทึกปัจจุบัน',
        'history_label_placeholder': 'ชื่อ/ไลน์ (ไม่บังคับ)',
        'history_empty': 'ยังไม่มีประวัติที่บันทึกไว้',
        'history_compare': 'เปรียบเทียบ',
        'history_delete_confirm': 'ลบรายการนี้ออกจากประวัติ?',
        'compare_back': 'กลับ',
        'compare_gap': 'ส่วนต่างจากเป้าหมาย',

        'ts_config_title': 'ตั้งค่า Time Study',
        'ts_confidence': 'ระดับความเชื่อมั่น',
        'ts_confidence_help': 'ยิ่งสูง → ต้องการรอบมากขึ้นเพื่อให้มั่นใจว่าค่าเฉลี่ยที่วัดได้ถูกต้อง (มาตรฐานอุตสาหกรรมใช้ 95%)',
        'ts_error': 'ค่าคลาดเคลื่อนที่ยอมรับได้ (±%)',
        'ts_error_help': 'ยอมให้ค่าเฉลี่ยเพี้ยนได้กี่ % จากค่าจริง (มาตรฐานอุตสาหกรรมใช้ 5%)',
        'ts_need_pilot': 'ต้องจับเวลาอย่างน้อย 2 รอบ (โหมด Lap) จึงจะคำนวณจำนวนรอบที่ควรจับได้',
        'ts_capped_df': 'ใช้ df = 30',
        'ts_msg_prefix': 'ที่ความเชื่อมั่น {conf}% ต้องจับเวลาอย่างน้อย {N_raw} รอบ (ปัดขึ้นเป็น {N} รอบ)',
        'ts_have_ok': 'คุณจับเวลา {n} รอบแล้ว — เพียงพอทางสถิติ สามารถใช้ค่าเฉลี่ยไปคำนวณ AMV ได้เลย',
        'ts_have_short': 'คุณจับเวลา {n} รอบ — ต้องจับเพิ่มอีก {more} รอบเพื่อให้ข้อมูลน่าเชื่อถือ',
        'ts_na': 'ต้องมี ≥ 2 รอบ',
        'ts_continue_btn': 'จับเวลาต่ออีก {more} รอบ',
        'ts_ttable_title': 'ตาราง T-Distribution',
        'ts_ttable_n': 'จำนวนรอบ (n)',
        'ts_ttable_note': 'แถวไฮไลต์คือ df ปัจจุบันของคุณ · คอลัมน์ไฮไลต์คือระดับความเชื่อมั่นที่เลือก (แบบสองหาง)',
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
        'sw_summary': 'Summary',
        'sw_avg': 'Average',
        'sw_fastest': 'Fastest Time',
        'sw_slowest': 'Slowest Time',
        'sw_total': 'Total Time',
        'sw_std': 'Standard Deviation (s)',
        'sw_required_n': 'Recommended cycles to time',
        'sw_info_total': 'Sum of all recorded round times',
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
        'sw_info_std': 'Standard deviation (Sample SD) — how much each round varies from the average; lower means more consistent. = √( Σ(round time − average)² ÷ (n−1) ) — uses n−1 (Bessel\'s correction) so it pairs correctly with the t-table in Time Study',

        'history_title': 'Evaluation History',
        'history_subtitle': 'Save and compare past evaluations',
        'history_save': 'Save Current',
        'history_label_placeholder': 'Name/Line (optional)',
        'history_empty': 'No saved history yet',
        'history_compare': 'Compare',
        'history_delete_confirm': 'Remove this entry from history?',
        'compare_back': 'Back',
        'compare_gap': 'Gap to Target',

        'ts_config_title': 'Time Study Settings',
        'ts_confidence': 'Confidence Level',
        'ts_confidence_help': 'Higher → needs more cycles to be sure the measured mean is correct (industry standard: 95%)',
        'ts_error': 'Acceptable Error (±%)',
        'ts_error_help': 'How many % the mean can deviate from the true value (industry standard: 5%)',
        'ts_need_pilot': 'Need at least 2 pilot cycles (Lap mode) to compute the recommended sample size',
        'ts_capped_df': 'using df = 30',
        'ts_msg_prefix': 'At {conf}% confidence, need at least {N_raw} cycles (rounded up to {N})',
        'ts_have_ok': 'You have {n} cycles — statistically sufficient, the mean is safe to use for AMV',
        'ts_have_short': 'You have {n} cycles — record {more} more to be statistically reliable',
        'ts_na': 'need ≥ 2 laps',
        'ts_continue_btn': 'Continue timing {more} more cycle(s)',
        'ts_ttable_title': 'T-Distribution Table',
        'ts_ttable_n': 'Cycles (n)',
        'ts_ttable_note': 'Highlighted row = your current df · highlighted column = selected confidence level (two-tailed)',
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
        'sw_summary': 'Tóm tắt',
        'sw_avg': 'Giá trị trung bình',
        'sw_fastest': 'Thời gian nhanh nhất',
        'sw_slowest': 'Thời gian chậm nhất',
        'sw_total': 'Tổng thời gian',
        'sw_std': 'Độ lệch chuẩn (s)',
        'sw_required_n': 'Số vòng nên bấm',
        'sw_info_total': 'Tổng thời gian của tất cả các vòng đã bấm',
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
        'sw_info_std': 'Độ lệch chuẩn (Sample SD) — cho biết thời gian mỗi vòng dao động quanh giá trị trung bình bao nhiêu; càng nhỏ càng ổn định. = √( Σ(thời gian vòng − trung bình)² ÷ (n−1) ) — dùng n−1 (hiệu chỉnh Bessel) để khớp với bảng t trong Time Study',

        'history_title': 'Lịch sử đánh giá',
        'history_subtitle': 'Lưu và so sánh các đánh giá trước đây',
        'history_save': 'Lưu hiện tại',
        'history_label_placeholder': 'Tên/Chuyền (không bắt buộc)',
        'history_empty': 'Chưa có lịch sử được lưu',
        'history_compare': 'So sánh',
        'history_delete_confirm': 'Xóa mục này khỏi lịch sử?',
        'compare_back': 'Trở lại',
        'compare_gap': 'Chênh lệch so với mục tiêu',

        'ts_config_title': 'Cài đặt Time Study',
        'ts_confidence': 'Mức độ tin cậy',
        'ts_confidence_help': 'Càng cao → cần nhiều vòng hơn để đảm bảo giá trị trung bình chính xác (chuẩn công nghiệp: 95%)',
        'ts_error': 'Sai số cho phép (±%)',
        'ts_error_help': 'Giá trị trung bình được phép lệch bao nhiêu % so với giá trị thực (chuẩn công nghiệp: 5%)',
        'ts_need_pilot': 'Cần ít nhất 2 vòng thử (chế độ Lap) để tính số vòng khuyến nghị',
        'ts_capped_df': 'dùng df = 30',
        'ts_msg_prefix': 'Ở mức tin cậy {conf}%, cần ít nhất {N_raw} vòng (làm tròn lên {N} vòng)',
        'ts_have_ok': 'Bạn đã bấm {n} vòng — đủ về mặt thống kê, có thể dùng giá trị trung bình để tính AMV',
        'ts_have_short': 'Bạn đã bấm {n} vòng — cần bấm thêm {more} vòng để đảm bảo tin cậy',
        'ts_na': 'cần ≥ 2 vòng',
        'ts_continue_btn': 'Bấm tiếp {more} vòng nữa',
        'ts_ttable_title': 'Bảng T-Distribution',
        'ts_ttable_n': 'Số vòng (n)',
        'ts_ttable_note': 'Hàng được đánh dấu = df hiện tại · cột được đánh dấu = mức tin cậy đã chọn (hai đuôi)',
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
        'sw_summary': 'ສະຫຼຸບຜົນ',
        'sw_avg': 'ຄ່າສະເລ່ຍ',
        'sw_fastest': 'ເວລາໄວທີ່ສຸດ',
        'sw_slowest': 'ເວລາຊ້າທີ່ສຸດ',
        'sw_total': 'ເວລາລວມ',
        'sw_std': 'ສ່ວນບ່ຽງເບນມາດຕະຖານ (s)',
        'sw_required_n': 'ຈຳນວນຮອບທີ່ຄວນຈັບເວລາ',
        'sw_info_total': 'ຜົນລວມເວລາທຸກຮອບທີ່ຈັບໄດ້',
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
        'sw_info_std': 'ສ່ວນບ່ຽງເບນມາດຕະຖານ (Sample SD) ບອກວ່າເວລາແຕ່ລະຮອບກະຈາຍຫ່າງຈາກຄ່າເສລ່ຍເທົ່າໃດ ຍິ່ງໜ້ອຍຍິ່ງສະໝ່ຳສະເໝີ = √( Σ(ເວລາຮອບ − ຄ່າເສລ່ຍ)² ÷ (n−1) ) — ໃຊ້ n−1 (Bessel) ເພື່ອໃຫ້ຄູ່ກັບຕາຕະລາງ t ໃນ Time Study',

        'history_title': 'ປະຫວັດການປະເມີນ',
        'history_subtitle': 'ບັນທຶກ ແລະ ປຽບທຽບຜົນການປະເມີນທີ່ຜ່ານມາ',
        'history_save': 'ບັນທຶກປັດຈຸບັນ',
        'history_label_placeholder': 'ຊື່/ໄລນ໌ (ບໍ່ບັງຄັບ)',
        'history_empty': 'ຍັງບໍ່ມີປະຫວັດທີ່ບັນທຶກໄວ້',
        'history_compare': 'ປຽບທຽບ',
        'history_delete_confirm': 'ລຶບລາຍການນີ້ອອກຈາກປະຫວັດ?',
        'compare_back': 'ກັບ',
        'compare_gap': 'ສ່ວນຕ່າງຈາກເປົ້າໝາຍ',

        'ts_config_title': 'ຕັ້ງຄ່າ Time Study',
        'ts_confidence': 'ລະດັບຄວາມເຊື່ອໝັ້ນ',
        'ts_confidence_help': 'ຍິ່ງສູງ → ຕ້ອງການຮອບຫຼາຍຂຶ້ນເພື່ອຮັບປະກັນຄ່າສະເລ່ຍທີ່ວັດໄດ້ຖືກຕ້ອງ (ມາດຕະຖານອຸດສາຫະກຳ: 95%)',
        'ts_error': 'ຄ່າຄາດເຄື່ອນທີ່ຍອມຮັບໄດ້ (±%)',
        'ts_error_help': 'ອະນຸຍາດໃຫ້ຄ່າສະເລ່ຍຄາດເຄື່ອນໄດ້ກີ່ % ຈາກຄ່າຈິງ (ມາດຕະຖານອຸດສາຫະກຳ: 5%)',
        'ts_need_pilot': 'ຕ້ອງຈັບເວລາຢ່າງໜ້ອຍ 2 ຮອບ (ໂໝດ Lap) ຈຶ່ງຈະຄຳນວນຈຳນວນຮອບທີ່ຄວນຈັບໄດ້',
        'ts_capped_df': 'ໃຊ້ df = 30',
        'ts_msg_prefix': 'ທີ່ຄວາມເຊື່ອໝັ້ນ {conf}% ຕ້ອງຈັບເວລາຢ່າງໜ້ອຍ {N_raw} ຮອບ (ປັດຂຶ້ນເປັນ {N} ຮອບ)',
        'ts_have_ok': 'ທ່ານຈັບເວລາ {n} ຮອບແລ້ວ — ພຽງພໍທາງສະຖິຕິ ສາມາດໃຊ້ຄ່າສະເລ່ຍໄປຄຳນວນ AMV ໄດ້ເລີຍ',
        'ts_have_short': 'ທ່ານຈັບເວລາ {n} ຮອບ — ຕ້ອງຈັບເພີ່ມອີກ {more} ຮອບເພື່ອໃຫ້ຂໍ້ມູນໜ້າເຊື່ອຖື',
        'ts_na': 'ຕ້ອງມີ ≥ 2 ຮອບ',
        'ts_continue_btn': 'ຈັບເວລາຕໍ່ອີກ {more} ຮອບ',
        'ts_ttable_title': 'ຕາຕະລາງ T-Distribution',
        'ts_ttable_n': 'ຈຳນວນຮອບ (n)',
        'ts_ttable_note': 'ແຖວທີ່ໄຮໄລ້ຄື df ປັດຈຸບັນ · ຄໍລຳທີ່ໄຮໄລ້ຄືລະດັບຄວາມເຊື່ອໝັ້ນທີ່ເລືອກ (ສອງຫາງ)',
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
    // Re-render Time Study readouts (their text is built from t() at render time)
    if (document.getElementById('swStatsPanel')?.style.display === 'block') tsRecalculate();
    if (document.getElementById('tsConfigModal')?.style.display === 'flex') renderTTable();
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
        const tsConfigModal = document.getElementById('tsConfigModal');
        if (tsConfigModal?.style.display === 'flex') { closeTsConfigModal(); closeLangMenu(); return; }
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

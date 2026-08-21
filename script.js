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
const STORAGE_KEY_SW      = 'csa_stopwatch_v1';
// STORAGE_KEY_HISTORY + HISTORY_MAX moved to history.js (their consumers live there)
const STORAGE_KEY_THEME   = 'csa_theme';
const FORM_FIELD_IDS = ['samInput','effTargetInput','totalMin','totalTime','totalCount','passQty','failQty','duration'];

// --- 1. Global State ---
let currentLang = 'th';
let samUnit = 'min'; // unit the user types SAM in: 'min' or 'sec'

// Session tracking flags (track each feature only once per session)
const _tracked = { quality: false, training: false };

// --- 2. Stopwatch Modal State ---
const sw = {
    running:   false,
    paused:    false,   // true when frozen via Pause (not yet finalized)
    finalized: false,   // true after Stop — stats panel should be shown on reopen
    mode:      'lap',   // 'lap' | 'single'
    elapsed:   0,       // total elapsed ms
    startTs:   null,    // timestamp when last started
    lapStart:  0,       // elapsed ms at start of current lap
    laps:      [],      // [ms per completed lap]
    interval:  null,
};

// --- 2b. Stopwatch persistence ---
// Save/restore across reloads and PWA re-launches so mid-shift lap data isn't
// lost. `startTs`, `running`, and `interval` are intentionally NOT persisted —
// on restore the clock is always frozen (paused or finalized).
function saveStopwatchState() {
    try {
        if (sw.elapsed === 0 && sw.laps.length === 0) {
            localStorage.removeItem(STORAGE_KEY_SW);
            return;
        }
        localStorage.setItem(STORAGE_KEY_SW, JSON.stringify({
            mode:      sw.mode,
            elapsed:   sw.elapsed,
            lapStart:  sw.lapStart,
            laps:      sw.laps.slice(),
            finalized: !!sw.finalized,
        }));
    } catch (_) { /* private browsing / quota — skip silently */ }
}

function restoreStopwatchState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_SW);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        sw.mode      = (s.mode === 'single' || s.mode === 'lap') ? s.mode : 'lap';
        sw.elapsed   = Number.isFinite(s.elapsed)  ? s.elapsed  : 0;
        sw.lapStart  = Number.isFinite(s.lapStart) ? s.lapStart : 0;
        sw.laps      = Array.isArray(s.laps) ? s.laps.filter(n => Number.isFinite(n)) : [];
        sw.running   = false;
        sw.finalized = !!s.finalized;
        // Anything not finalized is treated as paused so the user can Resume.
        sw.paused    = !sw.finalized && (sw.elapsed > 0 || sw.laps.length > 0);
    } catch (_) { /* corrupt storage — start fresh */ }
}

// Push the restored `sw` state onto the modal DOM. Called from
// openStopwatchModal() so the display, laps list, stats panel, and mode tabs
// reflect what was persisted.
function swSyncDomFromState() {
    const el = id => document.getElementById(id);
    // Mode tabs
    if (el('swTabLap'))    el('swTabLap').classList.toggle('active',    sw.mode === 'lap');
    if (el('swTabSingle')) el('swTabSingle').classList.toggle('active', sw.mode === 'single');
    // Main display
    if (el('swDisplay')) el('swDisplay').textContent = fmtSw(sw.elapsed);
    // Laps list + section visibility
    if (sw.mode === 'lap' && sw.laps.length > 0) {
        if (el('swLapSection')) el('swLapSection').style.display = 'block';
        swRenderLaps();
    } else {
        if (el('swLapSection')) el('swLapSection').style.display = 'none';
        if (el('swLapList'))    el('swLapList').innerHTML = '';
    }
    // Stats panel — only when the session was finalized (Stop pressed)
    if (sw.finalized && (sw.laps.length > 0 || sw.elapsed > 0)) {
        swShowStats();
    } else {
        if (el('swStatsPanel')) el('swStatsPanel').style.display = 'none';
        if (el('swSavePanel'))  el('swSavePanel').style.display  = 'none';
    }
}

// fmtSw / fmtSec2 / fmtSec4 / snapLapMs are defined in timeutil.js (loaded
// before this file in index.html) so they can be unit-tested from Node.

// ---- Ambient status ----
// Semantic thresholds for driving the ok/warn/bad tint on result fields.
// The thresholds match how a garment-line supervisor would grade the shift.
function statusForEfficiency(actualEff, targetEff) {
    if (!(targetEff > 0) || !Number.isFinite(actualEff)) return null;
    const ratio = actualEff / targetEff;
    if (ratio >= 0.90) return 'ok';
    if (ratio >= 0.75) return 'warn';
    return 'bad';
}
function statusForPassRate(rate) {
    if (!Number.isFinite(rate)) return null;
    if (rate >= 95) return 'ok';
    if (rate >= 85) return 'warn';
    return 'bad';
}
function setStatus(elId, status) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (status) el.dataset.status = status;
    else        delete el.dataset.status;
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
    swSyncDomFromState();   // restore display, laps, mode tabs, stats from persisted state
    swUpdateUI();
    swSetupKeyboardWatch();
}

function closeStopwatchModal() {
    if (sw.running) {
        // Freeze the clock and mark as paused (not finalized). On reopen the
        // user resumes the same lap instead of silently losing the in-progress time.
        swCancelTick();
        sw.elapsed = performance.now() - sw.startTs;
        sw.running = false;
        sw.paused  = true;
        swUpdateUI();
    }
    document.getElementById('swModal').style.display = 'none';
    document.body.style.overflow = '';
    swTeardownKeyboardWatch();
    saveStopwatchState();
}

// iOS Safari doesn't resize the layout viewport when the on-screen keyboard
// opens over a fixed overlay, so sticky bottom controls sit *under* the
// keyboard. Translate the save panel + continue button up by the height the
// visualViewport lost. No-op on browsers without visualViewport API.
function swSetupKeyboardWatch() {
    if (!window.visualViewport) return;
    const handler = () => {
        const vv = window.visualViewport;
        const lift = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const savePanel = document.getElementById('swSavePanel');
        if (savePanel) savePanel.style.transform = lift > 0 ? `translateY(-${lift}px)` : '';
    };
    window.visualViewport.addEventListener('resize', handler);
    window.visualViewport.addEventListener('scroll', handler);
    sw._kbHandler = handler;
}
function swTeardownKeyboardWatch() {
    if (!window.visualViewport || !sw._kbHandler) return;
    window.visualViewport.removeEventListener('resize', sw._kbHandler);
    window.visualViewport.removeEventListener('scroll', sw._kbHandler);
    const savePanel = document.getElementById('swSavePanel');
    if (savePanel) savePanel.style.transform = '';
    sw._kbHandler = null;
}

function swSetMode(mode) {
    if (sw.elapsed > 0) return; // cannot change mode after timing has started
    sw.mode = mode;
    document.getElementById('swTabLap').classList.toggle('active', mode === 'lap');
    document.getElementById('swTabSingle').classList.toggle('active', mode === 'single');
    swUpdateUI();
    saveStopwatchState();
}

function swStartStop() {
    if (!sw.running && !sw.paused) {
        // Start (or resume after a finalized Stop) — use monotonic time so
        // NTP corrections mid-lap can't jump the clock.
        sw.running   = true;
        sw.finalized = false;
        sw.startTs   = performance.now() - sw.elapsed;
        swScheduleTick();
    } else {
        // Stop / finalize. If we got here from Pause, the clock is already
        // frozen; otherwise freeze it now.
        if (sw.running) {
            swCancelTick();
            sw.elapsed = performance.now() - sw.startTs;
        }
        sw.running   = false;
        sw.paused    = false;
        sw.finalized = true;
        // In lap mode, Stop closes the in-progress lap so it counts as a
        // round too — e.g. Start → Lap ×3 → Stop yields 4 laps, not 3.
        if (sw.mode === 'lap' && sw.elapsed - sw.lapStart > 0) {
            sw.laps.push(snapLapMs(sw.elapsed - sw.lapStart));
            sw.lapStart = sw.elapsed;
        }
        swShowStats();
    }
    swUpdateUI();
    saveStopwatchState();
}

// Pause freezes the clock without ending the current lap or showing results;
// Resume continues the same lap from where it left off.
function swPauseResume() {
    if (sw.running) {
        // Pause
        swCancelTick();
        sw.elapsed = performance.now() - sw.startTs;
        sw.running = false;
        sw.paused  = true;
        swRenderLaps();   // freeze the running-lap row at its paused value
    } else if (sw.paused) {
        // Resume — same lap, no split
        sw.running = true;
        sw.paused  = false;
        sw.startTs = performance.now() - sw.elapsed;
        swScheduleTick();
    }
    swUpdateUI();
    saveStopwatchState();
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
        swCancelTick();
        Object.assign(sw, { running:false, paused:false, finalized:false, elapsed:0, startTs:null, lapStart:0, laps:[], interval:null });
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
    saveStopwatchState();
}

// rAF-driven ticker — ~30fps refresh (every 2nd frame at 60Hz displays),
// cached element refs, and monotonic time. Replaces the previous 100fps
// setInterval that was measurable battery drain on low-end Android.
let _swRafId = null;
let _swRafLast = 0;
let _swDispEl = null, _swLapTimeEl = null;

function swScheduleTick() {
    swCancelTick();
    _swDispEl    = null;   // resolved lazily below — the current-lap row
    _swLapTimeEl = null;   // in particular gets re-created by swRenderLaps()
    _swRafLast = 0;
    _swRafId = requestAnimationFrame(_swRafLoop);
}
function swCancelTick() {
    if (_swRafId !== null) cancelAnimationFrame(_swRafId);
    if (sw.interval)       clearInterval(sw.interval);  // legacy safety
    _swRafId = null;
    sw.interval = null;
}
function _swRafLoop(ts) {
    // Throttle to ~30fps — 2-decimal centisecond display doesn't need more.
    if (ts - _swRafLast >= 33) {
        _swRafLast = ts;
        sw.elapsed = performance.now() - sw.startTs;
        // Re-resolve elements when the cached ref is missing or detached.
        // The current-lap row (`swCurrentLapTime`) is recreated by
        // swRenderLaps() on every Lap press, so a stale cache would freeze
        // the running-lap counter — which is exactly the bug this fixes.
        if (!_swDispEl || !_swDispEl.isConnected) {
            _swDispEl = document.getElementById('swDisplay');
        }
        if (_swDispEl) _swDispEl.textContent = fmtSw(sw.elapsed);
        if (sw.mode === 'lap') {
            if (!_swLapTimeEl || !_swLapTimeEl.isConnected) {
                _swLapTimeEl = document.getElementById('swCurrentLapTime');
            }
            if (_swLapTimeEl) _swLapTimeEl.textContent = fmtSw(sw.elapsed - sw.lapStart);
        }
    }
    if (sw.running) _swRafId = requestAnimationFrame(_swRafLoop);
    else _swRafId = null;
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
            <span class="sw-lap-right">
                <span>${fmtSw(sw.laps[i])}</span>
                <button type="button" class="sw-lap-del" onclick="swDeleteLap(${i})"
                        aria-label="${t('sw_delete_lap')}" title="${t('sw_delete_lap')}">×</button>
            </span>
        </div>`;
    }
    list.innerHTML = html;
}

// Remove one completed lap. Available during running / paused / stopped.
// If the stats panel is already visible (post-Stop), recompute it.
function swDeleteLap(idx) {
    if (idx < 0 || idx >= sw.laps.length) return;
    showConfirm(t('sw_delete_lap'), t('sw_delete_lap_confirm'), () => _swDeleteLapConfirmed(idx));
}

function _swDeleteLapConfirmed(idx) {
    if (idx < 0 || idx >= sw.laps.length) return;
    sw.laps.splice(idx, 1);
    swRenderLaps();

    const statsPanel = document.getElementById('swStatsPanel');
    const lapSection = document.getElementById('swLapSection');
    const statsVisible = statsPanel && statsPanel.style.display !== 'none' && statsPanel.style.display !== '';
    if (sw.laps.length === 0) {
        if (lapSection) lapSection.style.display = 'none';
        if (statsPanel) statsPanel.style.display = 'none';
        const savePanel = document.getElementById('swSavePanel');
        if (savePanel && !sw.running && !sw.paused) savePanel.style.display = 'none';
    } else if (statsVisible) {
        swShowStats();
    } else {
        tsRecalculate();
    }
    saveStopwatchState();
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
// T_TABLE, tsTValue, and computeSampleSize live in timeutil.js so they can
// be unit-tested from Node without a DOM. The runtime state here is only
// the current user-chosen confidence + acceptable-error inputs.
const _ts = { confidence: 95, error: 5 };

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

// Export current evaluation as bilingual CSV (TH + EN column headers).
// Opens in Excel with Thai characters intact (UTF-8 BOM is prepended by csvBuild).
function exportCSV() {
    gaTrack('export_csv');

    const g   = id => document.getElementById(id);
    const val = id => (g(id)?.value ?? g(id)?.textContent ?? '').trim();
    const num = id => {
        // Strip trailing unit text (e.g. "89 %", "7 ชิ้น/ชม.") — keep the number.
        const raw = val(id);
        const m = raw.match(/^-?[0-9]+(?:[.,][0-9]+)?/);
        return m ? m[0] : raw;
    };

    const now  = new Date();
    const pad  = n => String(n).padStart(2, '0');
    const ts   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} `
               + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const fileTs = ts.replace(/[: ]/g, '-');

    // Rows — [Field (TH), Field (EN), Value, Unit]
    const rows = [
        ['ฟิลด์', 'Field', 'ค่า / Value', 'หน่วย / Unit'],
        ['วันที่-เวลา', 'Timestamp', ts, ''],
        ['เวอร์ชันแอป', 'App version', 'v1.13.0', ''],
        [],
        ['— ตั้งเป้าหมาย', '— Set Target', '', ''],
        ['ค่า SAM', 'SAM Value', val('samInput'), samUnit === 'sec' ? 'วินาที / sec' : 'นาที / min'],
        ['เป้าหมายประสิทธิภาพ', 'Target Efficiency', val('effTargetInput'), '%'],
        ['เป้าหมายชิ้นงาน', 'Target Output', num('targetDisplay'), 'ชิ้น/ชม. / pcs/hr'],
        ['ค่า SAM ใหม่ (เป้าหมาย)', 'New SAM (Target)', num('newSamDisplay'), samUnit === 'sec' ? 'วินาที / sec' : 'นาที / min'],
        [],
        ['— บันทึกผลงานจริง', '— Record Actual Results', '', ''],
        ['เวลารวม (นาที)', 'Total Time (Min)', val('totalMin'), 'นาที / min'],
        ['เวลารวม (วินาที)', 'Total Time (Sec)', val('totalTime'), 'วินาที / sec'],
        ['จำนวน (รอบ)', 'Count (Rounds)', val('totalCount'), 'รอบ / rounds'],
        ['เวลาต่อรอบ (วินาที)', 'Cycle Time (Sec)', num('avgTimeSec'), 'วินาที / sec'],
        ['เวลาต่อรอบ (นาที)', 'Cycle Time (Min)', num('avgTimeMin'), 'นาที / min'],
        ['ประสิทธิภาพจริง', 'Actual Efficiency', num('actualEffPerc'), '%'],
        ['ประสิทธิภาพจริง (ชิ้น/ชม.)', 'Actual Output', num('actualPcs'), 'ชิ้น/ชม. / pcs/hr'],
        [],
        ['— คุณภาพ', '— Quality', '', ''],
        ['จำนวนที่ผ่าน', 'Passed Qty', val('passQty'), 'ชิ้น / pcs'],
        ['จำนวนที่ไม่ผ่าน', 'Failed Qty', val('failQty'), 'ชิ้น / pcs'],
        ['อัตราการผ่าน', 'Pass Rate', num('passRate'), '%'],
        [],
        ['— วางแผนการฝึก', '— Training Plan', '', ''],
        ['ระยะเวลาการฝึก', 'Training Duration', val('duration'), 'วัน-ชม. / days-hrs'],
    ];

    const csv  = csvBuild(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `CSA-Evaluation-${fileTs}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick — the browser has already started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(currentLang === 'th' ? '📄 ดาวน์โหลด CSV แล้ว' : '📄 CSV downloaded');
}

// --- 3. Translations ---
// The `translations` object lives in translations.js (loaded before this
// file in index.html) so it can be lookup / fallback tested from Node
// and so this file stays focused on behaviour, not data.

// Inline SVG flags render identically on every platform — Chrome on Windows
// falls back to text pairs (TH / US / VN / LA) for the regional-indicator
// emojis because the system emoji font lacks flag glyphs.
const FLAG_SVG = {
    th: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect fill="#A51931" width="60" height="6.7"/><rect fill="#F4F5F8" y="6.7" width="60" height="6.6"/><rect fill="#2D2A4A" y="13.3" width="60" height="13.4"/><rect fill="#F4F5F8" y="26.7" width="60" height="6.6"/><rect fill="#A51931" y="33.3" width="60" height="6.7"/></svg>',
    en: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect fill="#B22234" width="60" height="40"/><g fill="#fff"><rect y="3.08" width="60" height="3.08"/><rect y="9.23" width="60" height="3.08"/><rect y="15.38" width="60" height="3.08"/><rect y="21.54" width="60" height="3.08"/><rect y="27.69" width="60" height="3.08"/><rect y="33.85" width="60" height="3.08"/></g><rect fill="#3C3B6E" width="24" height="21.54"/></svg>',
    vn: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect fill="#DA251D" width="60" height="40"/><polygon fill="#FF0" points="30,10 33.53,20.85 44.94,20.85 35.71,27.55 39.24,38.4 30,31.7 20.76,38.4 24.29,27.55 15.06,20.85 26.47,20.85"/></svg>',
    la: '<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect fill="#CE1126" width="60" height="40"/><rect fill="#002868" y="10" width="60" height="20"/><circle fill="#fff" cx="30" cy="20" r="6.7"/></svg>',
};

const LANG_META = {
    th: { flag: FLAG_SVG.th, name: 'ไทย' },
    en: { flag: FLAG_SVG.en, name: 'English' },
    vn: { flag: FLAG_SVG.vn, name: 'Tiếng Việt' },
    la: { flag: FLAG_SVG.la, name: 'ລາວ' },
};

const pcsPerHr = { th: 'ชิ้น/ชม.', en: 'pcs/hr', vn: 'SP/giờ', la: 'ຊິ້ນ/ຊມ' };

// Chart state + renderer live in chart.js — see that file for _chartCache,
// _chartAnimated, chartMode, setChartMode, renderChartFromCache, renderSVGChart.

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
    try { localStorage.setItem('csa_lang', lang); } catch {}
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

    // Trigger flag (inline SVG from FLAG_SVG — constant we author, XSS-safe)
    const flagEl = document.getElementById('currentFlag');
    if (flagEl) flagEl.innerHTML = FLAG_SVG[lang];
    // Screen readers announce the current language via the trigger's aria-label
    document.getElementById('actionsTrigger')?.setAttribute('aria-label', `Menu — ${LANG_META[lang].name}`);
    // Active state on the language pills inside the actions menu
    document.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === lang);
    });

    calculateAll(); // refresh pcs unit
    _flushHeavyUpdate(); // re-render training grid now so units match the new language
    swUpdateUI();
    // Re-render Time Study readouts (their text is built from t() at render time)
    if (document.getElementById('swStatsPanel')?.style.display === 'block') tsRecalculate();
    if (document.getElementById('tsConfigModal')?.style.display === 'flex') renderTTable();
}

// ---- Actions overflow menu ----
// One trigger button collapses every header action (language / export /
// history / install / theme / reset). Opens on tap, closes on outside tap
// or Escape. Language pills stay OPEN after switching (so the user can see
// which flag became active); everything else auto-closes on selection.
function toggleActionsMenu() {
    const m = document.getElementById('actionsMenu');
    const open = m.classList.toggle('open');
    document.getElementById('actionsTrigger')?.setAttribute('aria-expanded', open);
}
function closeActionsMenu() {
    const m = document.getElementById('actionsMenu');
    m?.classList.remove('open');
    document.getElementById('actionsTrigger')?.setAttribute('aria-expanded', 'false');
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

// --- 5c. History Storage moved to history.js ---

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
            // Ambient status tint — how does actual compare to target?
            const effStatus = statusForEfficiency(currentActualEff, effTarget);
            setStatus('actualEffPerc', effStatus);
            setStatus('actualPcs',     effStatus);
        } else {
            document.getElementById('actualEffPerc').value = '';
            document.getElementById('actualPcs').textContent = '';
            setStatus('actualEffPerc', null);
            setStatus('actualPcs', null);
        }
    } else {
        document.getElementById('actualEffPerc').value = '';
        ['avgTimeSec','avgTimeMin','actualPcs'].forEach(id => {
            document.getElementById(id).textContent = '';
        });
        setStatus('actualEffPerc', null);
        setStatus('actualPcs', null);
    }

    // 3. Quality
    const totalQty  = passQty + failQty;
    const passRate  = calcPassRate(passQty, failQty);
    document.getElementById('passRate').value = passRate !== null ? `${passRate} %` : "";
    setStatus('passRate', passRate !== null ? statusForPassRate(passRate) : null);
    if (!_tracked.quality && totalQty > 0) {
        _tracked.quality = true;
        gaTrack('use_quality_section');
    }

    // 4. Training Plan + form auto-save — the expensive DOM work (rebuilding
    //    up to 18 training cards + the SVG chart + a synchronous localStorage
    //    write) is debounced so a burst of keystrokes on a low-end Android
    //    doesn't rebuild the DOM on every character. Sections 1–3 above are
    //    just a handful of text writes and stay immediate.
    _scheduleHeavyUpdate({ sam, effTarget, currentActualEff, duration });
}

let _heavyTimer = null;
let _heavyPending = null;

function _scheduleHeavyUpdate(args) {
    _heavyPending = args;
    if (_heavyTimer) clearTimeout(_heavyTimer);
    _heavyTimer = setTimeout(_runHeavyUpdate, 150);
}

// Flush immediately — used at init/language-change (so the page paints complete)
// and on page-hide (so the last keystroke is never lost to the debounce).
function _flushHeavyUpdate() {
    if (_heavyTimer) { clearTimeout(_heavyTimer); _heavyTimer = null; }
    if (_heavyPending) _runHeavyUpdate();
}

function _runHeavyUpdate() {
    _heavyTimer = null;
    if (!_heavyPending) return;
    const { sam, effTarget, currentActualEff, duration } = _heavyPending;

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
            _chartAnimated = false;  // arm the draw-in animation for the next time
            if (tChart) tChart.style.display = 'none';
        }
    }

    saveFormState();
}

// --- 7. Learning Curve Chart moved to chart.js ---

// --- 8. Google Forms Integration ---
// Google Forms only accepts mode:'no-cors' so we can NEVER verify server-side
// success from the browser — every fetch() resolves opaquely. The real fix is
// a Cloudflare Worker / Supabase Edge Function that proxies + rate-limits +
// returns real ACKs. Until that ships, the best we can do is detect *network
// unavailability* and queue for the next `online` event so factory users
// who fill in feedback offline don't silently lose it.
async function sendToGoogleForms(rating, message, email) {
    const body = new URLSearchParams({
        [GFORM.entry.rating]:  String(rating || '-'),
        [GFORM.entry.message]: message,
        [GFORM.entry.email]:   email || '-',
    });
    await fetch(GFORM.url, { method: 'POST', mode: 'no-cors', body });
}

// ---- Feedback offline queue ----
const FEEDBACK_QUEUE_KEY = 'csa_feedback_queue_v1';
const FEEDBACK_QUEUE_MAX = 20;

function loadFeedbackQueue() {
    try {
        const raw = localStorage.getItem(FEEDBACK_QUEUE_KEY);
        const q = raw ? JSON.parse(raw) : [];
        return Array.isArray(q) ? q : [];
    } catch { return []; }
}
function saveFeedbackQueue(q) {
    try { localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function queueFeedback(entry) {
    const q = loadFeedbackQueue();
    q.push({ ...entry, queuedAt: Date.now() });
    // Cap oldest-first to keep localStorage bounded
    if (q.length > FEEDBACK_QUEUE_MAX) q.splice(0, q.length - FEEDBACK_QUEUE_MAX);
    saveFeedbackQueue(q);
    gaTrack('feedback_queued');
}
async function drainFeedbackQueue() {
    if (!navigator.onLine) return;
    const q = loadFeedbackQueue();
    if (!q.length) return;
    const remaining = [];
    for (const entry of q) {
        try { await sendToGoogleForms(entry.rating, entry.message, entry.email); }
        catch (_) { remaining.push(entry); }
    }
    saveFeedbackQueue(remaining);
    const sent = q.length - remaining.length;
    if (sent > 0) gaTrack('feedback_queue_drained', { sent });
}

// Drain whenever the browser reports connectivity restored.
window.addEventListener('online', drainFeedbackQueue);

// ---- PWA install ----
// Chrome/Edge/Android fire `beforeinstallprompt`. We stash the event, then
// reveal the header install chip once the user has opened the app more than
// once (avoids nagging on the first visit). Fully silent on iOS Safari and
// on browsers that never send the event.
let _pwaPrompt = null;
const SESSION_COUNT_KEY = 'csa_session_count';

function _bumpSessionCount() {
    try {
        const n = (parseInt(localStorage.getItem(SESSION_COUNT_KEY)) || 0) + 1;
        localStorage.setItem(SESSION_COUNT_KEY, String(n));
        return n;
    } catch { return 1; }
}
function _shouldOfferInstall() {
    // Already installed as a standalone PWA? Never re-offer.
    if (window.matchMedia('(display-mode: standalone)').matches) return false;
    if (window.navigator.standalone === true) return false;   // iOS PWA
    const n = parseInt(localStorage.getItem(SESSION_COUNT_KEY)) || 0;
    return n >= 2;
}

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _pwaPrompt = e;
    const btn = document.getElementById('installMenuItem');
    if (btn && _shouldOfferInstall()) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    gaTrack('pwa_installed');
    _pwaPrompt = null;
    const btn = document.getElementById('installMenuItem');
    if (btn) btn.style.display = 'none';
});

async function pwaInstall() {
    if (!_pwaPrompt) return;
    gaTrack('pwa_install_click');
    _pwaPrompt.prompt();
    const { outcome } = await _pwaPrompt.userChoice;
    gaTrack('pwa_install_choice', { outcome });
    _pwaPrompt = null;
    const btn = document.getElementById('installMenuItem');
    if (btn) btn.style.display = 'none';
}

// ---- First-run onboarding tour ----
const ONBOARDED_KEY = 'csa_onboarded_v1';
let _onboardStep = 0;

function showOnboardingIfNeeded() {
    try { if (localStorage.getItem(ONBOARDED_KEY)) return; } catch { return; }
    const ov = document.getElementById('onboardingOverlay');
    if (!ov) return;
    _onboardStep = 0;
    _renderOnboardStep();
    ov.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    gaTrack('onboarding_shown');
}
function _renderOnboardStep() {
    const screens = document.querySelectorAll('.onboard-screen');
    const dots    = document.querySelectorAll('.onboard-dot');
    screens.forEach((s, i) => { s.hidden = i !== _onboardStep; });
    dots.forEach   ((d, i) => d.classList.toggle('active', i === _onboardStep));
    const nextBtn = document.getElementById('onboardNextBtn');
    if (!nextBtn) return;
    const label = nextBtn.querySelector('.lang-text');
    const isLast = _onboardStep === screens.length - 1;
    const key = isLast ? 'ob_start' : 'ob_next';
    label.setAttribute('data-key', key);
    label.textContent = t(key);
}
function onboardNext() {
    const screens = document.querySelectorAll('.onboard-screen');
    if (_onboardStep >= screens.length - 1) { finishOnboarding(); return; }
    _onboardStep++;
    _renderOnboardStep();
    gaTrack('onboarding_next', { step: _onboardStep });
}
function finishOnboarding() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch {}
    const ov = document.getElementById('onboardingOverlay');
    if (ov) ov.style.display = 'none';
    document.body.style.overflow = '';
    gaTrack('onboarding_done', { step: _onboardStep });
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

// ---- Confirm modal (custom confirm() replacement) ----
// Reused by any destructive action that needs "are you sure?" — currently
// swDeleteLap. Callback runs only on OK; Cancel/backdrop/ESC dismiss silently.
let _confirmCallback = null;
function showConfirm(title, message, onOk, opts) {
    const modal = document.getElementById('confirmModal');
    if (!modal) { if (onOk) onOk(); return; }
    document.getElementById('confirmTitle').textContent   = title || '';
    document.getElementById('confirmMessage').textContent = message || '';
    const okLabel = document.getElementById('confirmOkLabel');
    if (okLabel) okLabel.textContent = (opts && opts.okLabel) || t('delete');
    _confirmCallback = typeof onOk === 'function' ? onOk : null;
    modal.style.display = 'flex';
}
function hideConfirm() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.style.display = 'none';
    _confirmCallback = null;
}

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

    let queued = false;
    if (GFORM_ENABLED) {
        if (!navigator.onLine) {
            // Offline right now → queue for the next `online` event
            queueFeedback({ rating, message, email });
            queued = true;
        } else {
            try { await sendToGoogleForms(rating, message, email); }
            catch (_) { queueFeedback({ rating, message, email }); queued = true; }
        }
    }

    closeFeedbackModal();
    showToast(queued
        ? (currentLang === 'th' ? '📨 บันทึกแล้ว จะส่งเมื่อออนไลน์' : '📨 Saved — will send when back online')
        : t('feedback_thanks'));

    submitFeedbackBtn.disabled = false;
    submitFeedbackBtn.style.opacity = '';
    sendLabel.innerText = originalText;
}

// --- 8a2. Formula Modal — show the "how it's calculated" for computed fields.
//     Every entry has titleKey (reuses the field label key) + formula/desc
//     translation keys, and a compute() that reads current inputs to build
//     the "your values" substituted line + the numeric result. compute()
//     returns null when required inputs are missing → we show fx_no_data. ---
const FORMULA_DEFS = {
    target_pcs: {
        titleKey:   'qty_label',
        formulaKey: 'fx_formula_target_pcs',
        descKey:    'fx_desc_target_pcs',
        compute() {
            const sam = getSamMinutes();
            const eff = parseFloat(document.getElementById('effTargetInput').value) || 0;
            if (!(sam > 0) || !(eff > 0)) return null;
            const pcs = pcsFromEff(sam, eff);
            return {
                substituted: `(60 ÷ ${trimNum(sam)}) × (${eff} ÷ 100) = ${pcs}`,
                result: `${pcs} ${pcsPerHr[currentLang] || 'pcs/hr'}`,
            };
        },
    },
    new_sam: {
        titleKey:   'new_sam_label',
        formulaKey: 'fx_formula_new_sam',
        descKey:    'fx_desc_new_sam',
        compute() {
            const sam = getSamMinutes();
            const eff = parseFloat(document.getElementById('effTargetInput').value) || 0;
            const newSamMin = newSamFromEff(sam, eff);
            if (newSamMin === null) return null;
            const val  = samUnit === 'sec' ? newSamMin * 60 : newSamMin;
            const unit = t(samUnit === 'sec' ? 'unit_sec' : 'unit_min');
            return {
                substituted: `${trimNum(sam)} ÷ (${eff} ÷ 100) = ${newSamMin.toFixed(3)} ${t('unit_min')}`,
                result: `${val.toFixed(2)} ${unit}`,
            };
        },
    },
    avg_sec: {
        titleKey:   'avg_timesec',
        formulaKey: 'fx_formula_avg_sec',
        descKey:    'fx_desc_avg_sec',
        compute() {
            const m = parseFloat(document.getElementById('totalMin').value) || 0;
            const s = parseFloat(document.getElementById('totalTime').value) || 0;
            const c = parseFloat(document.getElementById('totalCount').value) || 0;
            if (!(c > 0) || !(m > 0 || s > 0)) return null;
            const totalSec = m * 60 + s;
            const avgSec   = Math.ceil(totalSec / c);
            return {
                substituted: `((${m} × 60) + ${s}) ÷ ${c} = ${(totalSec / c).toFixed(2)}`,
                result: `${avgSec} ${t('unit_sec')}`,
            };
        },
    },
    avg_min: {
        titleKey:   'avg_timemin',
        formulaKey: 'fx_formula_avg_min',
        descKey:    'fx_desc_avg_min',
        compute() {
            const m = parseFloat(document.getElementById('totalMin').value) || 0;
            const s = parseFloat(document.getElementById('totalTime').value) || 0;
            const c = parseFloat(document.getElementById('totalCount').value) || 0;
            const avg = calcAvgMin(m, s, c);
            if (avg === null) return null;
            return {
                substituted: `((${m} × 60) + ${s}) ÷ ${c} ÷ 60 = ${avg.toFixed(4)}`,
                result: `${avg.toFixed(2)} ${t('unit_min')}`,
            };
        },
    },
    actual_eff: {
        titleKey:   'actual_eff',
        formulaKey: 'fx_formula_actual_eff',
        descKey:    'fx_desc_actual_eff',
        compute() {
            const sam = getSamMinutes();
            const m = parseFloat(document.getElementById('totalMin').value) || 0;
            const s = parseFloat(document.getElementById('totalTime').value) || 0;
            const c = parseFloat(document.getElementById('totalCount').value) || 0;
            const avg = calcAvgMin(m, s, c);
            const eff = calcActualEff(sam, avg);
            if (eff === null) return null;
            return {
                substituted: `(${trimNum(sam)} ÷ ${avg.toFixed(4)}) × 100 = ${eff}`,
                result: `${eff} %`,
            };
        },
    },
    actual_pcs: {
        titleKey:   'actual_pcs',
        formulaKey: 'fx_formula_actual_pcs',
        descKey:    'fx_desc_actual_pcs',
        compute() {
            const m = parseFloat(document.getElementById('totalMin').value) || 0;
            const s = parseFloat(document.getElementById('totalTime').value) || 0;
            const c = parseFloat(document.getElementById('totalCount').value) || 0;
            const avg = calcAvgMin(m, s, c);
            const pcs = calcActualPcsPerHr(avg);
            if (pcs === null) return null;
            return {
                substituted: `60 ÷ ${avg.toFixed(4)} = ${pcs}`,
                result: `${pcs} ${pcsPerHr[currentLang] || 'pcs/hr'}`,
            };
        },
    },
    pass_rate: {
        titleKey:   'pass_rate',
        formulaKey: 'fx_formula_pass_rate',
        descKey:    'fx_desc_pass_rate',
        compute() {
            const p = parseFloat(document.getElementById('passQty').value) || 0;
            const f = parseFloat(document.getElementById('failQty').value) || 0;
            const rate = calcPassRate(p, f);
            if (rate === null) return null;
            return {
                substituted: `(${p} ÷ (${p} + ${f})) × 100 = ${rate}`,
                result: `${rate} %`,
            };
        },
    },
};

function openFormulaModal(key) {
    const def = FORMULA_DEFS[key];
    if (!def) return;
    const modal = document.getElementById('formulaModal');
    if (!modal) return;

    document.getElementById('formulaTitle').textContent = t(def.titleKey);
    document.getElementById('formulaExpr').textContent  = t(def.formulaKey);
    document.getElementById('formulaDesc').textContent  = t(def.descKey);

    const subBlock  = document.getElementById('formulaSubBlock');
    const emptyMsg  = document.getElementById('formulaEmpty');
    const computed  = def.compute();
    if (computed) {
        subBlock.style.display = '';
        emptyMsg.style.display = 'none';
        document.getElementById('formulaSubstituted').textContent = computed.substituted;
        document.getElementById('formulaResult').textContent      = computed.result;
    } else {
        subBlock.style.display = 'none';
        emptyMsg.style.display = '';
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    gaTrack('open_formula', { key });
}

function closeFormulaModal() {
    const modal = document.getElementById('formulaModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// --- 8b. History / Compare Modal moved to history.js ---

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

// Confirm modal wiring
const _confirmModalEl  = document.getElementById('confirmModal');
const _confirmOkBtnEl  = document.getElementById('confirmOkBtn');
const _confirmCancelEl = document.getElementById('confirmCancelBtn');
_confirmOkBtnEl?.addEventListener('click', () => {
    const cb = _confirmCallback;
    hideConfirm();
    if (cb) cb();
});
_confirmCancelEl?.addEventListener('click', hideConfirm);
_confirmModalEl?.addEventListener('click', e => {
    if (e.target === _confirmModalEl) hideConfirm();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _confirmModalEl?.style.display === 'flex') hideConfirm();
});

// Back-to-Top FAB — appears once the user has scrolled past a screen-ish of content.
const _backToTopBtn = document.getElementById('backToTopBtn');
if (_backToTopBtn) {
    const SCROLL_THRESHOLD = 320;
    let _ticking = false;
    const updateBackToTop = () => {
        _ticking = false;
        _backToTopBtn.classList.toggle('visible', window.scrollY > SCROLL_THRESHOLD);
    };
    window.addEventListener('scroll', () => {
        if (!_ticking) {
            requestAnimationFrame(updateBackToTop);
            _ticking = true;
        }
    }, { passive: true });
    _backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    updateBackToTop();  // set correct initial state (in case page loads scrolled)
}

closeHistoryBtn?.addEventListener('click', closeHistoryModal);
historyCloseBtn?.addEventListener('click', closeHistoryModal);
historySaveBtn?.addEventListener('click', handleHistorySave);
historyCompareBtn?.addEventListener('click', openCompareView);
compareBackBtn?.addEventListener('click', showHistoryListView);
historyModal?.addEventListener('click', e => {
    if (e.target === historyModal) closeHistoryModal();
});

// Formula modal — event delegation on labels with data-fx
document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-fx]');
    if (trigger) {
        e.preventDefault();
        openFormulaModal(trigger.dataset.fx);
    }
});
document.getElementById('closeFormulaBtn')?.addEventListener('click', closeFormulaModal);
document.getElementById('closeFormulaOkBtn')?.addEventListener('click', closeFormulaModal);
document.getElementById('formulaModal')?.addEventListener('click', e => {
    if (e.target.id === 'formulaModal') closeFormulaModal();
});

document.getElementById('actionsTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleActionsMenu();
});
document.querySelectorAll('.lang-option').forEach(opt => {
    // Language pills swap language but leave the menu open so the user sees
    // which flag became active. Menu closes via outside-click / Escape.
    opt.addEventListener('click', () => changeLanguage(opt.dataset.lang));
});
document.addEventListener('click', e => {
    if (!e.target.closest('#actionsMenu')) closeActionsMenu();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (feedbackModal?.style.display === 'flex') closeFeedbackModal();
        if (historyModal?.style.display === 'flex') closeHistoryModal();
        const formulaModal = document.getElementById('formulaModal');
        if (formulaModal?.style.display === 'flex') { closeFormulaModal(); return; }
        const tsConfigModal = document.getElementById('tsConfigModal');
        if (tsConfigModal?.style.display === 'flex') { closeTsConfigModal(); closeActionsMenu(); return; }
        const swModal = document.getElementById('swModal');
        if (swModal?.style.display === 'flex') {
            const hasOpenInfo = document.querySelector('.sw-stat-desc.sw-show');
            if (hasOpenInfo) swCloseStatInfo();
            else closeStopwatchModal();
        } else {
            swCloseStatInfo();
        }
        closeActionsMenu();
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
restoreStopwatchState();
_bumpSessionCount();  // used by _shouldOfferInstall()
// Retry any feedback captured while previously offline (fire-and-forget)
drainFeedbackQueue();
// Show 3-screen tour on first launch only (persisted in localStorage)
showOnboardingIfNeeded();
// Restore last chosen language (falls back to Thai if unset or invalid)
const _savedLang = (() => { try { return localStorage.getItem('csa_lang'); } catch { return null; } })();
changeLanguage(_savedLang && translations[_savedLang] ? _savedLang : 'th');
calculateAll();
_flushHeavyUpdate();   // paint the training grid + chart immediately on first load
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

// Never lose the last keystroke to the debounce: flush the pending save when
// the tab is hidden or the app is being closed.
window.addEventListener('pagehide', _flushHeavyUpdate);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushHeavyUpdate();
});

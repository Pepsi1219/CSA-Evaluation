// Copyright (c) 2025 Pongsathon. All rights reserved.
// Proprietary — see LICENSE. Do not copy, redistribute, or reverse engineer.
// ============================================================
// APP — the rest of the app (UI wiring, calculateAll pipeline,
// stopwatch, feedback, PWA install, onboarding, theme, etc.)
// Init/boot moved to main.js; language state + t()/gaTrack() moved
// to state.js so chart/history/tutorial can import them without a
// circular dependency on this file.
// ============================================================
import { APP_VERSION } from './version.js';
import {
    parseNum, pcsFromEff, calcAvgMin, calcActualEff,
    newSamFromEff, calcActualPcsPerHr, calcPassRate, calcTrainingDay,
} from './calc.js';
import {
    fmtSw, fmtSec2, fmtSec4, snapLapMs,
    T_TABLE, tsTValue, computeSampleSize,
    csvEscape, csvRow, csvBuild,
} from './timeutil.js';
import {
    WESTINGHOUSE, WESTINGHOUSE_LABELS, ratingFactor,
    elementTimesFromReadings, computeStudy,
} from './ie.js';
import { translations } from './translations.js';
import {
    currentLang, setCurrentLang, t, gaTrack,
    pcsPerHr, GA4_ENABLED, GA4_MEASUREMENT_ID,
} from './state.js';
import { setChartCache, resetChartAnimation, renderChartFromCache } from './chart.js';
import {
    HISTORY_MAX, saveCurrentToHistory, loadHistory,
    handleHistorySave, openCompareView, closeHistoryModal, historyModal,
} from './history.js';
import { updateTutProgressBadge, tutorialOnLangChange, tutBack, closeTutorial } from './tutorial.js';

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
// CONFIG
// ============================================================
const MAX_TRAINING_DAYS = 18;

// ============================================================
// PERSISTENCE (localStorage) — form auto-save
// ============================================================
const STORAGE_KEY_FORM    = 'csa_form_v1';
const STORAGE_KEY_SW      = 'csa_stopwatch_v1';
const SW_LAPS_MAX         = 1000;   // hard ceiling on restored lap count (anti-corruption)
// STORAGE_KEY_HISTORY + HISTORY_MAX moved to history.js (their consumers live there)
const STORAGE_KEY_THEME       = 'csa_theme';
const STORAGE_KEY_TRAIN_CURVE = 'csa_train_curve';
const FORM_FIELD_IDS = ['samInput','effTargetInput','totalMin','totalTime','totalCount','passQty','failQty','duration'];

// --- 1. Local State (currentLang lives in state.js) ---
let samUnit = 'min'; // unit the user types SAM in: 'min' or 'sec'

// Training-plan curve shape: 'scurve' (default — Hermite smoothstep, realistic
// learning curve) or 'linear' (flat rate/day). Persisted per user via
// localStorage; consumed by the calcTrainingDay call in _runHeavyUpdate.
let trainCurve = (() => {
    try {
        const v = localStorage.getItem(STORAGE_KEY_TRAIN_CURVE);
        return v === 'linear' ? 'linear' : 'scurve';
    } catch { return 'scurve'; }
})();
export function getTrainCurve() { return trainCurve; }
export function setTrainCurve(mode) {
    const next = mode === 'linear' ? 'linear' : 'scurve';
    if (next === trainCurve) return;
    trainCurve = next;
    try { localStorage.setItem(STORAGE_KEY_TRAIN_CURVE, trainCurve); } catch {}
    gaTrack('set_train_curve', { curve: trainCurve });
    renderTrainCurveToggle();
    // Recompute the plan + chart immediately so the switch is visible.
    if (_heavyPending) _runHeavyUpdate();
    else calculateAll();
}
function renderTrainCurveToggle() {
    const g = document.getElementById('trainCurveToggle');
    if (!g) return;
    g.querySelectorAll('.chart-toggle-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.arg === trainCurve);
    });
}

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

export function restoreStopwatchState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_SW);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        sw.mode      = (s.mode === 'single' || s.mode === 'lap') ? s.mode : 'lap';
        sw.elapsed   = Number.isFinite(s.elapsed)  ? s.elapsed  : 0;
        sw.lapStart  = Number.isFinite(s.lapStart) ? s.lapStart : 0;
        // Keep only finite lap values, and cap the count so a corrupted/oversized
        // payload can't load a runaway array into memory (real time studies never
        // approach this many laps).
        sw.laps      = Array.isArray(s.laps)
            ? s.laps.filter(n => Number.isFinite(n)).slice(0, SW_LAPS_MAX)
            : [];
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
    if (el('swTabIE'))     el('swTabIE').classList.toggle('active',     sw.mode === 'ie');
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
export function openStopwatchModal() {
    gaTrack('open_stopwatch');
    document.getElementById('swModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    swSyncDomFromState();   // restore display, laps, mode tabs, stats from persisted state
    swUpdateUI();
    // Reflect current mode's panel visibility (also renders IE panels when active)
    _swSyncModePanels();
    swSetupKeyboardWatch();
}

export function closeStopwatchModal() {
    if (sw.running) {
        // Freeze the clock and mark as paused (not finalized). On reopen the
        // user resumes the same lap instead of silently losing the in-progress time.
        swCancelTick();
        sw.elapsed = performance.now() - sw.startTs;
        sw.running = false;
        sw.paused  = true;
        swUpdateUI();
    }
    if (ie.running) {
        // Same policy for IE: freeze the continuous clock; the user resumes
        // from the same tap count on reopen. Do NOT auto-finalize — the
        // operator hasn't seen the last element they were about to tap yet.
        ieCancelTick();
        ie.elapsed = performance.now() - ie.startTs;
        ie.running = false;
        ie.paused  = true;
        saveIEState();
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

export function swSetMode(mode) {
    if (mode !== 'lap' && mode !== 'single' && mode !== 'ie') return;
    // Guard: while a timer is actively counting, don't let a stray tab-tap wipe
    // it. Stopwatch guard = sw.elapsed>0; IE guard = readings recorded.
    if (mode !== 'ie' && sw.elapsed > 0) return;
    if (mode === 'ie'  && ie.running) return;
    // Switching INTO IE from another mode surfaces a one-tap gate so a
    // non-IE user (CSA / QCO instructor doing Cycle Time) doesn't fall into
    // the heavier element-by-element flow by accident. Re-tapping the IE tab
    // while already in IE is a no-op and skips the gate.
    if (mode === 'ie' && sw.mode !== 'ie') {
        _ieShowIntroModal();
        return;
    }
    _swApplyMode(mode);
}

function _swApplyMode(mode) {
    sw.mode = mode;
    document.getElementById('swTabLap')?.classList.toggle('active',    mode === 'lap');
    document.getElementById('swTabSingle')?.classList.toggle('active', mode === 'single');
    document.getElementById('swTabIE')?.classList.toggle('active',     mode === 'ie');
    _swSyncModePanels();
    if (mode !== 'ie') {
        swUpdateUI();
        saveStopwatchState();
    }
}

// ---- IE: intro gate ----
function _ieShowIntroModal() {
    const modal = document.getElementById('ieIntroModal');
    if (!modal) { _swApplyMode('ie'); return; }
    modal.style.display = 'flex';
}
function _ieHideIntroModal() {
    const modal = document.getElementById('ieIntroModal');
    if (modal) modal.style.display = 'none';
}
export function ieIntroConfirm() {
    _ieHideIntroModal();
    gaTrack('ie_intro_accept');
    _swApplyMode('ie');
}
export function ieIntroCancel() {
    _ieHideIntroModal();
    gaTrack('ie_intro_cancel');
}

// Show/hide the top-level panels that belong to each mode. Lap/Single reuse
// the classic stopwatch chrome; IE swaps in one of three IE panels driven by
// ie.setupDone / ie.finalized.
function _swSyncModePanels() {
    const g = id => document.getElementById(id);
    const stopwatchEls = [
        g('swTimerWrap') || document.querySelector('.sw-timer-wrap'),
        document.querySelector('.sw-controls'),
    ];
    const isIE = sw.mode === 'ie';
    stopwatchEls.forEach(el => { if (el) el.style.display = isIE ? 'none' : ''; });
    // Stats/lap/save panels only reveal themselves in stopwatch flow; hide
    // hard when we swap to IE regardless of their prior state.
    if (isIE) {
        ['swStatsPanel', 'swLapSection', 'swSavePanel'].forEach(id => {
            const el = g(id); if (el) el.style.display = 'none';
        });
    }
    // IE panels: chooser → setup → capture → result. The chooser gates the
    // rest; without a flow (SAM vs CT) there is nothing meaningful to set up.
    const inChooser = isIE && !ie.flow;
    const inSetup   = isIE &&  ie.flow && !ie.setupDone;
    const inCapture = isIE &&  ie.flow &&  ie.setupDone && !ie.finalized;
    const inResult  = isIE &&  ie.flow &&  ie.finalized;
    g('ieChooserPanel')&& (g('ieChooserPanel').style.display = inChooser ? 'block' : 'none');
    g('ieSetupPanel')  && (g('ieSetupPanel').style.display   = inSetup   ? 'block' : 'none');
    g('ieCapturePanel')&& (g('ieCapturePanel').style.display = inCapture ? 'block' : 'none');
    g('ieResultPanel') && (g('ieResultPanel').style.display  = inResult  ? 'block' : 'none');

    if (inSetup) ieRenderSetup();
    else if (inCapture) ieRenderCapture();
    else if (inResult) ieRenderResult();
}

export function swStartStop() {
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
export function swPauseResume() {
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

export function swLapOrReset() {
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
                <button type="button" class="sw-lap-del" data-action="sw-del-lap" data-arg="${i}"
                        aria-label="${t('sw_delete_lap')}" title="${t('sw_delete_lap')}">×</button>
            </span>
        </div>`;
    }
    list.innerHTML = html;
}

// Remove one completed lap. Available during running / paused / stopped.
// If the stats panel is already visible (post-Stop), recompute it.
export function swDeleteLap(idx) {
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
export function swToggleStatInfo(key) {
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

export function swSaveToForm() {
    gaTrack('save_stopwatch', { mode: sw.mode, laps: sw.laps.length });
    let totalMs, rounds;
    if (sw.mode === 'lap') {
        totalMs = sw.laps.reduce((a, b) => a + b, 0);
        rounds  = sw.laps.length;
    } else {
        totalMs = sw.elapsed;
        rounds  = parseInt(document.getElementById('swRoundsInput')?.value) || 1;
    }
    // Carry the full measured precision into the form. The seconds field now
    // accepts decimals, so instead of flooring to whole seconds (which threw
    // away the stopwatch's carefully-snapped 10 ms resolution and biased every
    // saved time downward) we keep 2 decimals — the same resolution the laps
    // are stored and displayed at.
    const totalSec2 = Math.round(totalMs / 10) / 100;   // seconds @ 10 ms res, 2 dp
    const mins      = Math.floor(totalSec2 / 60);
    const secs      = Math.round((totalSec2 - mins * 60) * 100) / 100;
    const g = id => document.getElementById(id);
    if (g('totalMin'))   g('totalMin').value   = mins;
    if (g('totalTime'))  g('totalTime').value  = secs;
    if (g('totalCount')) g('totalCount').value = rounds;
    calculateAll();
    closeStopwatchModal();
}

// ---- Time Study (Statistical Sample Size) ----
// T_TABLE, tsTValue, and computeSampleSize live in timeutil.js so they can
// be unit-tested from Node without a DOM. The runtime state here is only
// the current user-chosen confidence + acceptable-error inputs.
// Default = QCO preset (95% / ±10%) — matches the initial `.active` card in
// the config modal and the initial `value="10"` on tsErrorInput. Keep these
// three in lock-step: any change here needs the same change in index.html.
const _ts = { confidence: 95, error: 10 };

export function tsSetConfidence(c) {
    _ts.confidence = c;
    document.querySelectorAll('.sw-ts-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.conf) === c);
    });
    _renderTsPresetActive();
    tsRecalculate();
    gaTrack('ts_change_confidence', { confidence: c });
}

// Common IE presets: `<confidence>:<error>` pairs.
// - 95/5  : classic Niebel/Barnes standard for line time-studies.
// - 95/10 : quick pilot / preliminary sample when SD isn't known yet.
// - 99/3  : high-precision (audit / certification / benchmark work).
// Preset button reflects whatever pair the current state matches; if the user
// then tweaks either pill or the error input away from a preset, no button is
// active (they're on a custom combo).
export function tsApplyPreset(arg) {
    const [c, e] = String(arg).split(':').map(n => parseInt(n, 10));
    if (!(c > 0) || !(e > 0)) return;
    _ts.confidence = c;
    document.querySelectorAll('.sw-ts-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.conf) === c);
    });
    const errorInput = document.getElementById('tsErrorInput');
    if (errorInput) errorInput.value = String(e);
    // tsRecalculate reads tsErrorInput + writes _ts.error, then we mark the
    // matching preset. Order matters: recalc first so _ts.error is fresh.
    tsRecalculate();
    _renderTsPresetActive();
    gaTrack('ts_apply_preset', { confidence: c, error: e });
}

function _renderTsPresetActive() {
    const grid = document.getElementById('tsPresetGrid');
    if (!grid) return;
    const key = `${_ts.confidence}:${_ts.error}`;
    grid.querySelectorAll('.ts-preset-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.arg === key);
    });
}

export function tsRecalculate() {
    const errorInput = document.getElementById('tsErrorInput');
    let e = parseNum(errorInput?.value);
    if (!isFinite(e) || e <= 0) e = 5;
    if (e > 50) e = 50;
    _ts.error = e;
    // Keep the preset row in sync with whatever the numpad / conf pill last did.
    // Cheap DOM toggle — safe to call every recalc.
    _renderTsPresetActive();

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
export function swContinueTiming() {
    gaTrack('sw_continue_timing', { laps_so_far: sw.laps.length });
    // Hide summary + save panels; keep controls visible so Start is reachable
    const el = id => document.getElementById(id);
    if (el('swStatsPanel'))    el('swStatsPanel').style.display    = 'none';
    if (el('swSavePanel'))     el('swSavePanel').style.display     = 'none';
    if (el('swContinueBtn'))   el('swContinueBtn').style.display   = 'none';
    swCloseStatInfo();
    swUpdateUI();  // ensure Start button is in the correct resumable state
}

export function openTsConfigModal() {
    gaTrack('open_ts_config');
    renderTTable();
    const m = document.getElementById('tsConfigModal');
    if (m) m.style.display = 'flex';
}

export function closeTsConfigModal() {
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

// ============================================================
// IE — Time Study mode: Continuous Timing + Westinghouse rating +
// P/F/D allowances → per-element Standard Time → Total ST → SAM.
// Setup / capture / result each live in their own panel inside
// #swModal; _swSyncModePanels() decides which is visible.
// ============================================================
const STORAGE_KEY_IE = 'csa_ie_v1';
const IE_ELEM_MAX = 20;
const IE_ROUNDS_MAX = 200;
const IE_READINGS_MAX = IE_ELEM_MAX * IE_ROUNDS_MAX;
const IE_DEFAULT_RANK = { ws:'D', we:'D', wc:'D', wcon:'D' };
// Preset element names — the 4 garment-line staples for the shop-floor
// operator. `__custom__` reveals a text input for anything else. The
// preset key doubles as the translation-key suffix (`ie_preset_<key>`).
export const IE_PRESET_KEYS = ['pick', 'place', 'sew', 'inspect'];
export const IE_PRESET_CUSTOM = '__custom__';

// Each element carries `rated: false` by default — user has not opened the
// Rating picker yet, so we treat the observed time as Normal Time (RF = 1.00).
// The stored rank codes are only consumed when `rated === true`.
// `preset` is one of IE_PRESET_KEYS or IE_PRESET_CUSTOM. When custom, `name`
// holds the user-typed label; otherwise `name` is unused and the label is
// resolved through t() so it re-translates on language switch.
const _ieMakeElem = (preset = IE_PRESET_CUSTOM, name = '') => ({
    preset, name, rated: false, ...IE_DEFAULT_RANK,
});

// Reverse-lookup: given a display string (from an old record that only
// stored `name`), return the matching preset key if any language's label
// matches, else null. Used only on restore to keep old data snapping to
// presets rather than falling through to custom.
function _ieMatchPreset(displayName) {
    const s = (displayName || '').trim();
    if (!s) return null;
    for (const key of IE_PRESET_KEYS) {
        for (const lang of Object.keys(translations)) {
            if (translations[lang]?.[`ie_preset_${key}`] === s) return key;
        }
    }
    return null;
}

// Resolve an element's display label — translated preset, or the user's
// custom text, or an "#N" fallback so the row is never nameless.
function _ieElemLabel(e, idx1based) {
    if (!e) return `#${idx1based}`;
    if (e.preset && e.preset !== IE_PRESET_CUSTOM && IE_PRESET_KEYS.includes(e.preset)) {
        return t(`ie_preset_${e.preset}`);
    }
    const custom = (e.name || '').trim();
    return custom || `#${idx1based}`;
}

const ie = {
    // flow: null (chooser) | 'sam' (Standard time) | 'ct' (Cycle Time observation)
    flow:      null,
    // setup
    setupDone: false,
    rounds:    10,
    elements:  IE_PRESET_KEYS.map(k => _ieMakeElem(k)),
    allowance: { personal: 5, fatigue: 5, delay: 5 },
    // capture
    running:   false,
    paused:    false,
    finalized: false,
    startTs:   null,
    elapsed:   0,
    readings:  [],   // cumulative ms per tap
};

// rAF ticker refs (separate from stopwatch's — the two clocks are mutually
// exclusive via mode, but keeping the refs apart avoids accidental cross-wire).
let _ieRafId = null;
let _ieRafLast = 0;
let _ieDispEl = null;

function saveIEState() {
    try {
        // Nothing meaningful to persist yet → clear so a stale entry can't
        // resurrect an empty chooser after reset. flow=null with default setup
        // is the "fresh" state.
        if (!ie.flow && !ie.setupDone && ie.readings.length === 0
            && !ie.elements.some(e => (e.name || '').trim() !== '')
            && ie.rounds === 10) {
            localStorage.removeItem(STORAGE_KEY_IE);
            return;
        }
        localStorage.setItem(STORAGE_KEY_IE, JSON.stringify({
            flow:      ie.flow,
            setupDone: !!ie.setupDone,
            rounds:    ie.rounds,
            elements:  ie.elements.slice(),
            allowance: { ...ie.allowance },
            finalized: !!ie.finalized,
            elapsed:   ie.elapsed,
            readings:  ie.readings.slice(),
        }));
    } catch (_) { /* private / quota — silent */ }
}

export function restoreIEState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_IE);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (!s || typeof s !== 'object') return;
        ie.flow      = (s.flow === 'sam' || s.flow === 'ct') ? s.flow : null;
        ie.setupDone = !!s.setupDone;
        ie.rounds    = Number.isFinite(s.rounds) && s.rounds > 0
            ? Math.min(IE_ROUNDS_MAX, Math.floor(s.rounds)) : 10;
        ie.elements  = Array.isArray(s.elements) && s.elements.length
            ? s.elements.slice(0, IE_ELEM_MAX).map(e => {
                // Migrate old records that stored only `name`. If the name
                // matches one of the preset translations in any language we
                // treat it as that preset; otherwise it stays custom.
                let preset = e?.preset;
                if (!preset) preset = _ieMatchPreset(e?.name) || IE_PRESET_CUSTOM;
                if (preset !== IE_PRESET_CUSTOM && !IE_PRESET_KEYS.includes(preset)) {
                    preset = IE_PRESET_CUSTOM;
                }
                return {
                    preset,
                    name:  String(e?.name ?? ''),
                    rated: !!e?.rated,
                    ws:    String(e?.ws   ?? 'D'),
                    we:    String(e?.we   ?? 'D'),
                    wc:    String(e?.wc   ?? 'D'),
                    wcon:  String(e?.wcon ?? 'D'),
                };
              })
            : IE_PRESET_KEYS.map(k => _ieMakeElem(k));
        ie.allowance = {
            personal: Number(s.allowance?.personal) || 0,
            fatigue:  Number(s.allowance?.fatigue)  || 0,
            delay:    Number(s.allowance?.delay)    || 0,
        };
        ie.elapsed   = Number.isFinite(s.elapsed) ? s.elapsed : 0;
        ie.readings  = Array.isArray(s.readings)
            ? s.readings.filter(n => Number.isFinite(n)).slice(0, IE_READINGS_MAX)
            : [];
        ie.running   = false;
        ie.finalized = !!s.finalized;
        // Without a flow there's no meaningful setup — snap back to the chooser.
        if (!ie.flow) { ie.setupDone = false; ie.finalized = false; }
        ie.paused    = ie.setupDone && !ie.finalized && (ie.elapsed > 0 || ie.readings.length > 0);
    } catch (_) { /* corrupt — start fresh */ }
}

// Escape user-supplied element names before interpolation into innerHTML —
// avoids an XSS vector via a text input the operator could paste HTML into.
function _ieEsc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---- IE: rAF ticker ----
function ieScheduleTick() {
    ieCancelTick();
    _ieDispEl = null;
    _ieRafLast = 0;
    _ieRafId = requestAnimationFrame(_ieRafLoop);
}
function ieCancelTick() {
    if (_ieRafId !== null) cancelAnimationFrame(_ieRafId);
    _ieRafId = null;
}
function _ieRafLoop(ts) {
    if (ts - _ieRafLast >= 33) {
        _ieRafLast = ts;
        ie.elapsed = performance.now() - ie.startTs;
        if (!_ieDispEl || !_ieDispEl.isConnected) _ieDispEl = document.getElementById('ieDisplay');
        if (_ieDispEl) _ieDispEl.textContent = fmtSw(ie.elapsed);
    }
    if (ie.running) _ieRafId = requestAnimationFrame(_ieRafLoop);
    else _ieRafId = null;
}

// ---- IE: setup panel ----
function _ieClampInt(raw, min, max) {
    const n = parseInt(String(raw ?? '').replace(',', '.'), 10);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}
function _ieClampFloat(raw) {
    const n = parseFloat(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(95, n);
}

function ieRenderSetup() {
    const g = id => document.getElementById(id);
    // Title + allowance visibility diverge by flow. CT observes an operator
    // against an existing SAM, so Rating (post-timing) and Allowance don't
    // apply — hiding the whole allowance group avoids adding noise the
    // observer would just ignore.
    const isCT = ie.flow === 'ct';
    const titleEl = g('ieSetupTitle');
    if (titleEl) titleEl.textContent = t(isCT ? 'ie_setup_title_ct' : 'ie_setup_title');
    const alwGroup = g('ieAllowanceGroup');
    if (alwGroup) alwGroup.style.display = isCT ? 'none' : '';
    // Values → inputs (only when they differ, so focus + numpad don't fight it)
    const rIn = g('ieRoundsInput');    if (rIn && rIn.value !== String(ie.rounds))            rIn.value = String(ie.rounds);
    const cIn = g('ieElemCountInput'); if (cIn && cIn.value !== String(ie.elements.length))   cIn.value = String(ie.elements.length);
    const setAlw = (id, v) => { const el = g(id); if (el && el.value !== String(v)) el.value = String(v); };
    setAlw('ieAlwPersonal', ie.allowance.personal);
    setAlw('ieAlwFatigue',  ie.allowance.fatigue);
    setAlw('ieAlwDelay',    ie.allowance.delay);
    const alwTot = ie.allowance.personal + ie.allowance.fatigue + ie.allowance.delay;
    const alwTotEl = g('ieAlwTotal');
    if (alwTotEl) alwTotEl.textContent = `${alwTot.toFixed(alwTot % 1 === 0 ? 0 : 1)}%`;
    // Element list — preset dropdown + optional custom text. Performance
    // Rating is captured AFTER timing (in the result panel), so setup stays
    // quick to fill on the shop floor.
    const list = g('ieElemList');
    if (!list) return;
    const presetOpts = IE_PRESET_KEYS
        .map(k => `<option value="${k}">${_ieEsc(t(`ie_preset_${k}`))}</option>`)
        .concat(`<option value="${IE_PRESET_CUSTOM}">${_ieEsc(t('ie_preset_custom'))}</option>`)
        .join('');
    list.innerHTML = ie.elements.map((e, i) => {
        const isCustom = e.preset === IE_PRESET_CUSTOM;
        return `
        <div class="ie-elem-row" data-idx="${i}">
            <div class="ie-elem-row-head">
                <span class="ie-elem-badge">${i + 1}</span>
                <select class="ie-elem-preset" data-ie-preset="${i}">${presetOpts}</select>
                <button type="button" class="ie-elem-del" data-action="ie-elem-del" data-arg="${i}"
                        aria-label="${_ieEsc(t('ie_del_elem'))}" title="${_ieEsc(t('ie_del_elem'))}">×</button>
            </div>
            <input type="text" class="ie-elem-name-custom" data-ie-name="${i}"
                   placeholder="${_ieEsc(t('ie_elem_name_ph'))}" value="${_ieEsc(e.name || '')}"
                   style="display:${isCustom ? 'block' : 'none'};">
        </div>
        `;
    }).join('');
    // Restore each select's active option (innerHTML dropped the "selected" state)
    list.querySelectorAll('select[data-ie-preset]').forEach(sel => {
        const i = Number(sel.dataset.iePreset);
        if (ie.elements[i]) sel.value = ie.elements[i].preset || IE_PRESET_CUSTOM;
    });
    // Clear any prior error
    const err = g('ieSetupError'); if (err) { err.style.display = 'none'; err.textContent = ''; }
}

// Delegated listeners for the setup form (bound once — see IIFE at bottom).
function _ieOnSetupInput(e) {
    const t = e.target;
    if (!t) return;
    if (t.id === 'ieRoundsInput') {
        ie.rounds = _ieClampInt(t.value, 1, IE_ROUNDS_MAX);
        saveIEState();
        return;
    }
    if (t.id === 'ieElemCountInput') {
        const next = _ieClampInt(t.value, 1, IE_ELEM_MAX);
        ieSetElemCount(next);
        return;
    }
    if (t.id === 'ieAlwPersonal') { ie.allowance.personal = _ieClampFloat(t.value); _ieRefreshAlwTotal(); saveIEState(); return; }
    if (t.id === 'ieAlwFatigue')  { ie.allowance.fatigue  = _ieClampFloat(t.value); _ieRefreshAlwTotal(); saveIEState(); return; }
    if (t.id === 'ieAlwDelay')    { ie.allowance.delay    = _ieClampFloat(t.value); _ieRefreshAlwTotal(); saveIEState(); return; }
    if (t.dataset.ieName !== undefined) {
        const i = Number(t.dataset.ieName);
        if (ie.elements[i]) { ie.elements[i].name = t.value; saveIEState(); }
        return;
    }
}
// Preset dropdown change → swap preset and toggle the custom text input.
function _ieOnSetupChange(e) {
    const el = e.target;
    if (!el || el.dataset.iePreset === undefined) return;
    const i = Number(el.dataset.iePreset);
    if (!ie.elements[i]) return;
    const next = el.value === IE_PRESET_CUSTOM || IE_PRESET_KEYS.includes(el.value)
        ? el.value : IE_PRESET_CUSTOM;
    ie.elements[i].preset = next;
    // Reveal / hide the sibling custom text input without re-rendering the
    // whole list (avoids collapsing an active numpad or losing focus).
    const row = el.closest('.ie-elem-row');
    const custom = row?.querySelector('.ie-elem-name-custom');
    if (custom) custom.style.display = next === IE_PRESET_CUSTOM ? 'block' : 'none';
    saveIEState();
}
function _ieRefreshAlwTotal() {
    const el = document.getElementById('ieAlwTotal');
    if (!el) return;
    const tot = ie.allowance.personal + ie.allowance.fatigue + ie.allowance.delay;
    el.textContent = `${tot.toFixed(tot % 1 === 0 ? 0 : 1)}%`;
}

function ieSetElemCount(n) {
    n = Math.max(1, Math.min(IE_ELEM_MAX, n));
    if (n === ie.elements.length) return;
    if (n > ie.elements.length) {
        while (ie.elements.length < n) ie.elements.push(_ieMakeElem());
    } else {
        ie.elements.length = n;
    }
    ieRenderSetup();
    saveIEState();
}

export function ieElemAdd() {
    if (ie.elements.length >= IE_ELEM_MAX) return;
    ie.elements.push(_ieMakeElem());
    const cIn = document.getElementById('ieElemCountInput');
    if (cIn) cIn.value = String(ie.elements.length);
    ieRenderSetup();
    saveIEState();
}
export function ieElemDel(idx) {
    if (ie.elements.length <= 1) return;
    if (idx < 0 || idx >= ie.elements.length) return;
    ie.elements.splice(idx, 1);
    const cIn = document.getElementById('ieElemCountInput');
    if (cIn) cIn.value = String(ie.elements.length);
    ieRenderSetup();
    saveIEState();
}

// ---- IE: transitions ----
// Chooser → Setup. Setting the flow reveals the setup panel; CT hides the
// Allowance group inside it. Called from the `ie-flow` action.
export function ieSetFlow(flow) {
    const next = (flow === 'sam' || flow === 'ct') ? flow : null;
    if (!next) return;
    ie.flow      = next;
    ie.setupDone = false;
    ie.finalized = false;
    gaTrack('ie_pick_flow', { flow: next });
    _swSyncModePanels();
    saveIEState();
}

// Setup/Result → Chooser. If they've captured readings, confirm — same policy
// as ieBackToSetup, since going back to the chooser also throws away data.
export function ieBackToChooser() {
    const doReset = () => {
        ieCancelTick();
        ie.flow      = null;
        ie.setupDone = false;
        ie.finalized = false;
        ie.running   = false;
        ie.paused    = false;
        ie.startTs   = null;
        ie.elapsed   = 0;
        ie.readings  = [];
        _swSyncModePanels();
        saveIEState();
    };
    const hasData = ie.readings.length > 0 || ie.elapsed > 0;
    if (hasData) showConfirm(t('ie_back_to_chooser'), t('ie_reset_confirm'), doReset);
    else doReset();
}

export function ieStart() {
    // Validate: rounds ≥ 1 and every element has a name.
    if (!(ie.rounds >= 1)) {
        _ieShowSetupError(t('ie_setup_error_rounds')); return;
    }
    if (!ie.elements.length
        || ie.elements.some(e => e.preset === IE_PRESET_CUSTOM && (e.name || '').trim() === '')) {
        _ieShowSetupError(t('ie_setup_error_elem')); return;
    }
    ie.setupDone = true;
    ie.finalized = false;
    ie.readings  = [];
    ie.elapsed   = 0;
    ie.running   = false;
    ie.paused    = false;
    gaTrack('ie_start_capture', { cycles: ie.rounds, elements: ie.elements.length });
    _swSyncModePanels();
    saveIEState();
}

function _ieShowSetupError(msg) {
    const err = document.getElementById('ieSetupError');
    if (!err) return;
    err.textContent = msg;
    err.style.display = 'block';
}

export function ieBackToSetup() {
    // If the user goes back with readings recorded, confirm — otherwise the
    // continuous timing series they collected is thrown away.
    const hasData = ie.readings.length > 0 || ie.elapsed > 0;
    const doReset = () => {
        ieCancelTick();
        ie.setupDone = false;
        ie.finalized = false;
        ie.running   = false;
        ie.paused    = false;
        ie.startTs   = null;
        ie.elapsed   = 0;
        ie.readings  = [];
        _swSyncModePanels();
        saveIEState();
    };
    if (hasData) showConfirm(t('ie_back_to_setup'), t('ie_reset_confirm'), doReset);
    else doReset();
}

export function ieStartStop() {
    const total = ie.rounds * ie.elements.length;
    if (!ie.running && !ie.finalized) {
        // Start or resume
        ie.running = true;
        ie.startTs = performance.now() - ie.elapsed;
        ieScheduleTick();
        gaTrack('ie_startstop', { action: 'start', taps: ie.readings.length });
    } else if (ie.running) {
        // Stop — freeze and (if any readings) finalize.
        ieCancelTick();
        ie.elapsed = performance.now() - ie.startTs;
        ie.running = false;
        ie.paused  = false;
        if (ie.readings.length > 0) ieFinalize();
        gaTrack('ie_startstop', { action: 'stop', taps: ie.readings.length, total });
    }
    _ieUpdateCaptureControls();
    saveIEState();
}

export function ieTap() {
    if (!ie.running) return;
    const total = ie.rounds * ie.elements.length;
    if (ie.readings.length >= total) return;   // already full — Stop is next
    // Snap to 10 ms so stored value == displayed value.
    const snapped = snapLapMs(performance.now() - ie.startTs);
    ie.readings.push(snapped);
    // Auto-finalize on the last tap so the operator doesn't hunt for Stop.
    if (ie.readings.length >= total) {
        ieCancelTick();
        ie.elapsed = performance.now() - ie.startTs;
        ie.running = false;
        ieFinalize();
    }
    ieRenderCapture();
    saveIEState();
}

export function ieUndo() {
    if (ie.readings.length === 0) return;
    ie.readings.pop();
    ieRenderCapture();
    saveIEState();
}

function ieFinalize() {
    ie.finalized = true;
    _swSyncModePanels();
}

// ---- IE: capture rendering ----
function _ieCurrentPosition() {
    const total = ie.rounds * ie.elements.length;
    const nElems = ie.elements.length;
    const done = ie.readings.length;
    if (done >= total) return { cycle: ie.rounds, elemIdx: nElems, complete: true, total, done };
    const cycle = Math.floor(done / nElems) + 1;
    const elemIdx = (done % nElems) + 1;
    return { cycle, elemIdx, complete: false, total, done };
}

function ieRenderCapture() {
    const g = id => document.getElementById(id);
    const dispEl = g('ieDisplay');
    if (dispEl) dispEl.textContent = fmtSw(ie.elapsed);
    const pos = _ieCurrentPosition();
    const headerEl = g('ieCaptureHeader');
    if (headerEl) {
        if (pos.complete) {
            headerEl.textContent = t('ie_capture_done');
        } else {
            const name = _ieElemLabel(ie.elements[pos.elemIdx - 1], pos.elemIdx);
            headerEl.textContent = t('ie_capture_header')
                .replace('{cur}', pos.cycle).replace('{tot}', ie.rounds)
                .replace('{name}', name)
                .replace('{e}', pos.elemIdx).replace('{n}', ie.elements.length);
        }
    }
    const progEl = g('ieProgressLabel');
    if (progEl) progEl.textContent = t('ie_progress_label')
        .replace('{done}', pos.done).replace('{total}', pos.total);
    _ieUpdateCaptureControls();
    _ieRenderLiveTable();
}

function _ieUpdateCaptureControls() {
    const g = id => document.getElementById(id);
    const startBtn = g('ieStartStopBtn');
    const tapBtn   = g('ieTapBtn');
    const undoBtn  = g('ieUndoBtn');
    const pos = _ieCurrentPosition();
    if (startBtn) {
        const label = startBtn.querySelector('.lang-text');
        if (ie.running) {
            startBtn.className = 'sw-modal-btn sw-btn-stop';
            if (label) { label.textContent = t('sw_stop'); label.dataset.key = 'sw_stop'; }
        } else if (ie.finalized) {
            startBtn.className = 'sw-modal-btn sw-btn-secondary sw-btn-disabled';
            startBtn.disabled = true;
        } else {
            startBtn.className = 'sw-modal-btn sw-btn-start';
            startBtn.disabled = false;
            if (label) {
                const key = ie.elapsed > 0 ? 'sw_resume' : 'sw_start';
                label.textContent = t(key); label.dataset.key = key;
            }
        }
    }
    if (tapBtn) {
        const disabled = !ie.running || pos.complete;
        tapBtn.disabled = disabled;
        tapBtn.classList.toggle('sw-btn-disabled', disabled);
    }
    if (undoBtn) {
        undoBtn.disabled = ie.readings.length === 0 || ie.running;
        undoBtn.classList.toggle('sw-btn-disabled', undoBtn.disabled);
    }
}

function _ieRenderLiveTable() {
    const tbl = document.getElementById('ieLiveTable');
    if (!tbl) return;
    const N = ie.elements.length;
    if (N === 0) { tbl.innerHTML = ''; return; }
    // Header
    let html = '<thead><tr><th>#</th>';
    for (let c = 1; c <= ie.rounds; c++) html += `<th>${c}</th>`;
    html += '</tr></thead><tbody>';
    // Per-element rows
    const matrix = elementTimesFromReadings(ie.readings, N);
    for (let e = 0; e < N; e++) {
        const label = _ieEsc(_ieElemLabel(ie.elements[e], e + 1));
        html += `<tr><th title="${label}">${label}</th>`;
        for (let c = 0; c < ie.rounds; c++) {
            const v = matrix[c]?.[e];
            html += `<td>${Number.isFinite(v) ? fmtSec2(v) : '·'}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody>';
    tbl.innerHTML = html;
}

// ---- IE: result rendering ----
let _ieLastStudy = null;

function ieRenderResult() {
    const isCT = ie.flow === 'ct';
    const N = ie.elements.length;
    const matrix = elementTimesFromReadings(ie.readings, N);
    // Elements that haven't been rated yet are treated as Normal Pace
    // (RF = 1.00) — the picker records the user's choice on top afterwards.
    // For CT we force RF=1 and zero allowances so mean == NT == ST and the
    // totals reflect the raw observed cycle time.
    const ranks = isCT
        ? ie.elements.map(_ => ({ ...IE_DEFAULT_RANK }))
        : ie.elements.map(e => (
            e.rated ? { ws: e.ws, we: e.we, wc: e.wc, wcon: e.wcon } : { ...IE_DEFAULT_RANK }
        ));
    const alw = isCT ? { personal: 0, fatigue: 0, delay: 0 } : ie.allowance;
    const study = computeStudy(matrix, ranks, alw);
    _ieLastStudy = study;

    // Panel title + Save-button label are flow-driven.
    const titleEl = document.getElementById('ieResultTitle');
    if (titleEl) titleEl.textContent = t(isCT ? 'ie_result_title_ct' : 'ie_result_title');
    const saveLbl = document.getElementById('ieSaveBtnLabel');
    if (saveLbl) saveLbl.textContent = t(isCT ? 'ie_save_ct_btn' : 'ie_save_sam_btn');

    const tbl = document.getElementById('ieResultTable');
    if (tbl) {
        let html = '<thead><tr>'
            + `<th>${_ieEsc(t('ie_result_col_elem'))}</th>`
            + `<th>${_ieEsc(t('ie_result_col_mean'))}</th>`
            + `<th>${_ieEsc(t('ie_result_col_sd'))}</th>`;
        if (!isCT) {
            html += `<th>${_ieEsc(t('ie_result_col_rf'))}</th>`
                +  `<th>${_ieEsc(t('ie_result_col_nt'))}</th>`
                +  `<th>${_ieEsc(t('ie_result_col_st'))}</th>`;
        }
        html += `<th>${_ieEsc(t('ie_result_col_nreq_t'))}</th>`
            +  `<th>${_ieEsc(t('ie_result_col_nreq_m'))}</th>`
            +  '</tr></thead><tbody>';
        study.rows.forEach((r, i) => {
            const elem = ie.elements[i];
            const name = _ieEsc(_ieElemLabel(elem, i + 1));
            html += '<tr>'
                + `<td class="ie-r-name">${name}</td>`
                + `<td>${fmtSec2(r.meanMs)}</td>`
                + `<td>${fmtSec4(r.sdMs)}</td>`;
            if (!isCT) {
                const btnLabel = elem?.rated
                    ? `${(r.rf * 100).toFixed(0)}%`
                    : _ieEsc(t('ie_rating_btn_unrated'));
                const btnCls = 'ie-rating-btn' + (elem?.rated ? ' ie-rating-btn-set' : '');
                html += `<td><button type="button" class="${btnCls}" data-action="ie-rating-open" data-arg="${i}">${btnLabel}</button></td>`
                    +  `<td>${fmtSec2(r.ntMs)}</td>`
                    +  `<td class="ie-r-st">${fmtSec2(r.stMs)}</td>`;
            }
            html += `<td>${r.requiredNT || '·'}</td>`
                +  `<td>${r.requiredNMaytag || '·'}</td>`
                +  '</tr>';
        });
        html += '</tbody>';
        tbl.innerHTML = html;
    }
    // Sample-size warnings
    const warnEl = document.getElementById('ieResultWarnings');
    if (warnEl) {
        const rows = study.rows
            .map((r, i) => ({ i, r, name: _ieElemLabel(ie.elements[i], i + 1) }))
            .filter(x => x.r.requiredNT > x.r.n);
        if (rows.length) {
            warnEl.innerHTML = rows.map(({ name, r }) => {
                const line = _ieEsc(t('ie_result_warn_more')
                    .replace('{n}', r.n).replace('{req}', r.requiredNT));
                return `<div class="ie-warn-row"><strong>${_ieEsc(name)}</strong> — ${line}</div>`;
            }).join('');
            warnEl.style.display = 'block';
        } else {
            warnEl.innerHTML = '';
            warnEl.style.display = 'none';
        }
    }
    // Totals
    const totEl = document.getElementById('ieResultTotals');
    if (totEl) {
        if (isCT) {
            // For CT we didn't apply rating or allowance, so totalStandardMs
            // equals the sum of per-element means — i.e. the observed cycle
            // time per piece. Show that + the number of pieces observed.
            const totalCtMin = study.totalStandardMs / 60000;
            const totalCtSec = study.totalStandardMs / 1000;
            totEl.innerHTML = `
                <div class="ie-total-row">
                    <span>${t('ie_result_total_ct_pcs')}</span>
                    <span>${ie.rounds}</span>
                </div>
                <div class="ie-total-row">
                    <span>${t('ie_result_total_ct_sec')}</span>
                    <span>${totalCtSec.toFixed(2)} s</span>
                </div>
                <div class="ie-total-row ie-total-hero">
                    <span>${t('ie_result_total_ct_min')}</span>
                    <span><strong>${totalCtMin.toFixed(4)}</strong> ${t('unit_min')}</span>
                </div>`;
        } else {
            const totalStMin = study.totalStandardMs / 60000;
            const totalStSec = study.totalStandardMs / 1000;
            totEl.innerHTML = `
                <div class="ie-total-row">
                    <span>${t('ie_result_allowance')}</span>
                    <span>${study.totalAllowancePct.toFixed(study.totalAllowancePct % 1 === 0 ? 0 : 1)}%</span>
                </div>
                <div class="ie-total-row">
                    <span>${t('ie_result_total_st_sec')}</span>
                    <span>${totalStSec.toFixed(2)} s</span>
                </div>
                <div class="ie-total-row ie-total-hero">
                    <span>${t('ie_result_total_st_min')}</span>
                    <span><strong>${totalStMin.toFixed(4)}</strong> ${t('unit_min')}</span>
                </div>`;
        }
    }
}

// ---- IE: save to main form ----
export function ieSaveToForm() {
    if (!_ieLastStudy) return;
    const totalStandardMs = _ieLastStudy.totalStandardMs;
    if (!(totalStandardMs > 0)) return;

    if (ie.flow === 'ct') {
        // Cycle Time observation → totalMin + totalTime + totalCount so the
        // main form recomputes Actual Efficiency against whichever SAM is
        // already in samInput. `totalStandardMs` here equals sum-of-means
        // per piece (RF=1, allowance=0 in CT), so total observed time = that
        // × pieces observed.
        const pieces = Math.max(1, ie.rounds);
        const totalMs = totalStandardMs * pieces;
        const totalSec2 = Math.round(totalMs / 10) / 100;
        const mins = Math.floor(totalSec2 / 60);
        const secs = Math.round((totalSec2 - mins * 60) * 100) / 100;
        const g = id => document.getElementById(id);
        if (g('totalMin'))   g('totalMin').value   = mins;
        if (g('totalTime'))  g('totalTime').value  = secs;
        if (g('totalCount')) g('totalCount').value = pieces;
        calculateAll();
        gaTrack('ie_save_ct', {
            total_ct_min: +(totalMs / 60000).toFixed(4),
            pieces,
            elements:    ie.elements.length,
        });
        closeStopwatchModal();
        return;
    }

    // SAM flow (default): write per-piece standard time to samInput.
    const totalStMin = totalStandardMs / 60000;
    // Route: SAM must be in minutes (Standard Time is a per-piece minute value).
    // Switch unit to 'min' first (no conversion) so the field's meaning is
    // clear, then write the value and trigger the full recalc pipeline.
    setSamUnit('min', false);
    const samEl = document.getElementById('samInput');
    if (samEl) {
        samEl.value = trimNum(totalStMin);
        samEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    gaTrack('ie_save_sam', {
        total_st_min: +totalStMin.toFixed(4),
        elements:     ie.elements.length,
        cycles:       ie.rounds,
        allowance:    _ieLastStudy.totalAllowancePct,
    });
    closeStopwatchModal();
}

// ---- IE: Rating picker modal ----
let _ieRatingElemIdx = null;

// Which Westinghouse field goes with which element key + code universe.
const _IE_RATING_FIELDS = [
    { key: 'ws',   table: 'skill',       codes: Object.keys(WESTINGHOUSE.skill) },
    { key: 'we',   table: 'effort',      codes: Object.keys(WESTINGHOUSE.effort) },
    { key: 'wc',   table: 'conditions',  codes: Object.keys(WESTINGHOUSE.conditions) },
    { key: 'wcon', table: 'consistency', codes: Object.keys(WESTINGHOUSE.consistency) },
];

export function openIeRatingModal(idx) {
    idx = Number(idx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= ie.elements.length) return;
    _ieRatingElemIdx = idx;
    const elem = ie.elements[idx];
    const modal = document.getElementById('ieRatingModal');
    if (!modal) return;
    const titleEl = document.getElementById('ieRatingTitle');
    const rawName = _ieElemLabel(elem, idx + 1);
    if (titleEl) titleEl.textContent = `${t('ie_rating_pick_title')} — ${rawName}`;
    _ieRenderRatingLists();
    _ieRefreshRatingSummary();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    gaTrack('ie_open_rating', { element: idx, was_rated: !!elem.rated });
}

export function closeIeRatingModal() {
    const modal = document.getElementById('ieRatingModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = 'hidden';   // sw modal is still open
    _ieRatingElemIdx = null;
    // Result table + totals must reflect any rating change the user made.
    if (ie.finalized) ieRenderResult();
}

// Render the 4 code lists inside the picker. Each button carries data-ie-rp
// with the field key + code so the delegated click handler can route it.
function _ieRenderRatingLists() {
    const elem = ie.elements[_ieRatingElemIdx];
    if (!elem) return;
    const noneBtn = document.querySelector('.ie-rating-none-btn');
    if (noneBtn) noneBtn.classList.toggle('ie-rating-none-active', !elem.rated);

    _IE_RATING_FIELDS.forEach(({ key, table, codes }) => {
        const list = document.getElementById(`ieRatingList_${key}`);
        if (!list) return;
        const active = elem[key];
        list.innerHTML = codes.map(code => {
            const val = WESTINGHOUSE[table][code];
            const sign = val > 0 ? '+' : (val < 0 ? '' : ' ');   // + for positive, blank for zero
            const slug = WESTINGHOUSE_LABELS[table][code];
            const label = _ieEsc(t(`ie_rating_lbl_${slug}`));
            const isActive = elem.rated && active === code;
            return `<button type="button" class="ie-rating-cell${isActive ? ' active' : ''}"
                data-ie-rp="${key}" data-ie-rp-code="${code}">
                <span class="ie-rating-val">${sign}${val.toFixed(2)}</span>
                <span class="ie-rating-code">${code}</span>
                <span class="ie-rating-lbl">${label}</span>
            </button>`;
        }).join('');
    });
}

function _ieRefreshRatingSummary() {
    const elem = ie.elements[_ieRatingElemIdx];
    if (!elem) return;
    const rf = elem.rated ? ratingFactor(elem) : 1;
    const el = document.getElementById('ieRatingSummary');
    if (el) el.textContent = elem.rated ? `${(rf * 100).toFixed(0)}%` : t('ie_rating_btn_unrated');
}

// User tapped a code cell — record it, mark rated, refresh visuals.
export function ieRatingPick(field, code) {
    if (_ieRatingElemIdx === null) return;
    const elem = ie.elements[_ieRatingElemIdx];
    if (!elem || !field || !code) return;
    if (!_IE_RATING_FIELDS.some(f => f.key === field)) return;
    elem[field] = code;
    elem.rated = true;
    _ieRenderRatingLists();
    _ieRefreshRatingSummary();
    saveIEState();
    gaTrack('ie_pick_rating', { element: _ieRatingElemIdx, field, code });
}

// "ไม่ระบุ Rating" — reset to Normal Pace (RF=1.00).
export function ieRatingNone() {
    if (_ieRatingElemIdx === null) return;
    const elem = ie.elements[_ieRatingElemIdx];
    if (!elem) return;
    elem.rated = false;
    // Keep the codes as D/D/D/D so if the user re-rates later they see a sane
    // starting point. `rated:false` is what tells the compute layer to use 1.00.
    elem.ws = 'D'; elem.we = 'D'; elem.wc = 'D'; elem.wcon = 'D';
    _ieRenderRatingLists();
    _ieRefreshRatingSummary();
    saveIEState();
    gaTrack('ie_pick_rating', { element: _ieRatingElemIdx, field: 'none', code: 'none' });
}

// Delegated click for the rating cell buttons + backdrop dismiss.
document.getElementById('ieRatingModal')?.addEventListener('click', e => {
    if (e.target.id === 'ieRatingModal') { closeIeRatingModal(); return; }
    const btn = e.target.closest('[data-ie-rp]');
    if (!btn) return;
    ieRatingPick(btn.dataset.ieRp, btn.dataset.ieRpCode);
});

// Bind the setup panel's inputs + preset selects (delegated so re-rendered
// rows keep working).
document.getElementById('ieSetupPanel')?.addEventListener('input', _ieOnSetupInput);
document.getElementById('ieSetupPanel')?.addEventListener('change', _ieOnSetupChange);

// ---- Export / Print ----
export function printReport() {
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
export function exportCSV() {
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
        ['เวอร์ชันแอป', 'App version', 'v' + APP_VERSION, ''],
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
export const FLAG_SVG = {
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

// pcsPerHr + t() live in state.js so chart.js / history.js / tutorial.js can
// import them without a circular dependency on this file.

// Chart state + renderer live in chart.js — see that file for _chartCache,
// _chartAnimated, chartMode, setChartMode, renderChartFromCache, renderSVGChart.

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
export function changeLanguage(lang) {
    if (!translations[lang]) return;
    gaTrack('change_language', { language: lang });
    setCurrentLang(lang);
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
    // IE mode UI is JS-rendered via t() at render time — re-render the visible panel.
    if (sw.mode === 'ie' && document.getElementById('swModal')?.style.display === 'flex') {
        if (!ie.setupDone) ieRenderSetup();
        else if (ie.finalized) ieRenderResult();
        else ieRenderCapture();
    }
    if (document.getElementById('ieRatingModal')?.style.display === 'flex' && _ieRatingElemIdx !== null) {
        // Reopen to refresh title + qualitative labels — same element index.
        openIeRatingModal(_ieRatingElemIdx);
    }
    // Tutorial content is rendered from JS (L() picks the language) — re-render if open.
    tutorialOnLangChange();
}

// ---- Actions overflow menu ----
// One trigger button collapses every header action (language / export /
// history / install / theme / reset). Opens on tap, closes on outside tap
// or Escape. Language pills stay OPEN after switching (so the user can see
// which flag became active); everything else auto-closes on selection.
export function toggleActionsMenu() {
    const m = document.getElementById('actionsMenu');
    const open = m.classList.toggle('open');
    document.getElementById('actionsTrigger')?.setAttribute('aria-expanded', open);
}
export function closeActionsMenu() {
    const m = document.getElementById('actionsMenu');
    m?.classList.remove('open');
    document.getElementById('actionsTrigger')?.setAttribute('aria-expanded', 'false');
}

export function resetForm() {
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

export function restoreFormState() {
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
    // Reflect the persisted train-curve pick in the pill toggle. Cheap to call
    // regardless of whether the storage read above succeeded.
    renderTrainCurveToggle();
}

// --- 5c. History Storage moved to history.js ---

// --- 5d. SAM Unit (min / sec) ---
// Format a number for display: trim trailing zeros, cap at 4 decimals.
function trimNum(n) {
    return parseFloat(n.toFixed(4)).toString();
}

// SAM value in minutes, regardless of the unit the user is typing in.
export function getSamMinutes() {
    const raw = parseNum(document.getElementById('samInput').value) || 0;
    return samUnit === 'sec' ? raw / 60 : raw;
}

// Switch the SAM input between minutes and seconds. When `convert` is true
// (a user click) the typed value is converted so the underlying SAM is
// unchanged; on restore we pass false to keep the already-stored value.
export function setSamUnit(unit, convert = true) {
    if (unit !== 'min' && unit !== 'sec') return;
    if (convert && unit !== samUnit) {
        const el  = document.getElementById('samInput');
        const raw = parseNum(el.value);
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
export function calculateAll() {
    const getValue = id => parseNum(document.getElementById(id).value) || 0;

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
        // Show the exact cycle time (2 decimals) — efficiency + pcs below are
        // computed from the same unrounded avgMin, so the displayed seconds now
        // reconcile with them instead of being ceil'd up out of agreement.
        setResultUnit('avgTimeSec', (avgMin * 60).toFixed(2), t('unit_sec'));
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
export function _flushHeavyUpdate() {
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
                const { eff: dayEff, pcs: dayPcs } = calcTrainingDay(currentActualEff, gap, duration, i, sam, trainCurve);
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

            setChartCache({
                data:       chartData,
                targetPcs:  pcsFromEff(sam, effTarget),
                effTarget,
                currentEff: currentActualEff,
                currentPcs: pcsFromEff(sam, currentActualEff),
            });
            renderChartFromCache();
        } else {
            tGrid.innerHTML = '';
            setChartCache({ data: [], targetPcs: 0, effTarget: 0 });
            resetChartAnimation();  // arm the draw-in animation for the next time
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
export async function drainFeedbackQueue() {
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

export function _bumpSessionCount() {
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

export async function pwaInstall() {
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

export function showOnboardingIfNeeded() {
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
export function onboardNext() {
    const screens = document.querySelectorAll('.onboard-screen');
    if (_onboardStep >= screens.length - 1) { finishOnboarding(); return; }
    _onboardStep++;
    _renderOnboardStep();
    gaTrack('onboarding_next', { step: _onboardStep });
}
export function finishOnboarding() {
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

export function openFeedbackModal() {
    feedbackModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}
export function closeFeedbackModal() {
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
            const eff = parseNum(document.getElementById('effTargetInput').value) || 0;
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
            const eff = parseNum(document.getElementById('effTargetInput').value) || 0;
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
            const m = parseNum(document.getElementById('totalMin').value) || 0;
            const s = parseNum(document.getElementById('totalTime').value) || 0;
            const c = parseNum(document.getElementById('totalCount').value) || 0;
            if (!(c > 0) || !(m > 0 || s > 0)) return null;
            const totalSec = m * 60 + s;
            const avgSec   = totalSec / c;
            return {
                substituted: `((${m} × 60) + ${s}) ÷ ${c} = ${avgSec.toFixed(2)}`,
                result: `${avgSec.toFixed(2)} ${t('unit_sec')}`,
            };
        },
    },
    avg_min: {
        titleKey:   'avg_timemin',
        formulaKey: 'fx_formula_avg_min',
        descKey:    'fx_desc_avg_min',
        compute() {
            const m = parseNum(document.getElementById('totalMin').value) || 0;
            const s = parseNum(document.getElementById('totalTime').value) || 0;
            const c = parseNum(document.getElementById('totalCount').value) || 0;
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
            const m = parseNum(document.getElementById('totalMin').value) || 0;
            const s = parseNum(document.getElementById('totalTime').value) || 0;
            const c = parseNum(document.getElementById('totalCount').value) || 0;
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
            const m = parseNum(document.getElementById('totalMin').value) || 0;
            const s = parseNum(document.getElementById('totalTime').value) || 0;
            const c = parseNum(document.getElementById('totalCount').value) || 0;
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
            const p = parseNum(document.getElementById('passQty').value) || 0;
            const f = parseNum(document.getElementById('failQty').value) || 0;
            const rate = calcPassRate(p, f);
            if (rate === null) return null;
            return {
                substituted: `(${p} ÷ (${p} + ${f})) × 100 = ${rate}`,
                result: `${rate} %`,
            };
        },
    },
};

export function openFormulaModal(key) {
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

export function closeFormulaModal() {
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

export function toggleTheme() {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY_THEME, next); } catch (_) { /* skip silently */ }
    applyTheme(next);
    gaTrack('toggle_theme', { theme: next });
}

export function initTheme() {
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY_THEME); } catch (_) { /* skip silently */ }
    // Light is the locked default for the app; only the user toggling to
    // dark (persisted in localStorage) opts in. We ignore the OS
    // prefers-color-scheme signal on purpose so a dark-mode phone doesn't
    // silently flip the shop-floor UI. The CSS `@media (prefers-color-scheme:
    // dark) :root:not([data-theme="light"])` gate means setting
    // data-theme="light" here also locks light on cold start.
    applyTheme(stored === 'dark' ? 'dark' : 'light');
}

// --- 8d. In-app Numpad ---------------------------------------------------
// Every editable numeric field carries inputmode="none" (so the mobile OS
// keyboard never opens) plus data-numpad ("int" | "decimal") and
// data-numpad-label (a translation key for the sheet header). Tapping a field
// opens this keypad; each key rewrites the field's value and re-fires its
// native `input` event, so the existing per-field handlers (calculateAll /
// tsRecalculate) run untouched — one seam, no recompute logic duplicated here.
// Physical keyboards still type normally (inputmode only suppresses the
// on-screen one), so desktop entry is unaffected.
const _numpad = { field: null, buffer: '', decimal: false };

export function openNumpad(field) {
    const modal = document.getElementById('numpadModal');
    if (!field || !modal) return;
    _numpad.field   = field;
    // Normalize a legacy comma value to a dot so the pad edits it consistently.
    _numpad.buffer  = String(field.value || '').replace(',', '.');
    _numpad.decimal = field.dataset.numpad === 'decimal';

    const dotKey = document.getElementById('numpadDotKey');
    if (dotKey) dotKey.style.visibility = _numpad.decimal ? '' : 'hidden';

    const labelEl = document.getElementById('numpadFieldLabel');
    if (labelEl) labelEl.textContent = field.dataset.numpadLabel ? t(field.dataset.numpadLabel) : '';

    _renderNumpad();
    modal.style.display = 'flex';
    gaTrack('open_numpad', { field: field.id || '' });
}

export function closeNumpad() {
    const modal = document.getElementById('numpadModal');
    if (!modal) return;
    // Drop a dangling trailing dot on commit so "5." is stored as "5".
    if (_numpad.field && /\.$/.test(_numpad.buffer)) {
        _numpad.buffer = _numpad.buffer.slice(0, -1);
        _commitNumpad();
    }
    modal.style.display = 'none';
    _numpad.field = null;
    _numpad.buffer = '';
}

function _renderNumpad() {
    const disp = document.getElementById('numpadValue');
    if (disp) disp.textContent = _numpad.buffer === '' ? '0' : _numpad.buffer;
}

// Write the buffer back to the field and re-fire its input handler so the whole
// calc pipeline reacts live, exactly as if the user had typed the character.
export function _commitNumpad() {
    if (!_numpad.field) return;
    _numpad.field.value = _numpad.buffer;
    _numpad.field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function numpadPress(key) {
    if (!_numpad.field) return;
    if (key === 'back') {
        _numpad.buffer = _numpad.buffer.slice(0, -1);
    } else if (key === '.') {
        if (!_numpad.decimal || _numpad.buffer.includes('.')) return;
        _numpad.buffer = _numpad.buffer === '' ? '0.' : _numpad.buffer + '.';
    } else {
        // Replace a lone leading zero so "0" then "5" is "5", never "05".
        _numpad.buffer = _numpad.buffer === '0' ? key : _numpad.buffer + key;
    }
    _renderNumpad();
    _commitNumpad();
}

export function numpadClear() {
    if (!_numpad.field) return;
    _numpad.buffer = '';
    _renderNumpad();
    _commitNumpad();
}

// Open on click of any numpad field (delegated so it also covers the two
// fields living inside the stopwatch / Time-Study modals).
document.addEventListener('click', e => {
    const field = e.target.closest('input[data-numpad]');
    if (field) openNumpad(field);
});
document.querySelectorAll('#numpadModal [data-numkey]').forEach(btn => {
    btn.addEventListener('click', () => numpadPress(btn.dataset.numkey));
});
document.getElementById('numpadDoneBtn')?.addEventListener('click', closeNumpad);
document.getElementById('numpadCloseBtn')?.addEventListener('click', closeNumpad);
document.getElementById('numpadClearBtn')?.addEventListener('click', numpadClear);
document.getElementById('numpadModal')?.addEventListener('click', e => {
    if (e.target.id === 'numpadModal') closeNumpad();
});

// --- 8e. Settings modal ---------------------------------------------------
// Hosts the tutorial launcher only (labelled "ระบบฝึกสอนการใช้งาน"). Theme +
// language live back in the header overflow menu, so this sheet is purely the
// entry point into the learning centre.
export function openSettingsModal() {
    const m = document.getElementById('settingsModal');
    if (!m) return;
    updateTutProgressBadge();
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    gaTrack('open_settings');
}
export function closeSettingsModal() {
    const m = document.getElementById('settingsModal');
    if (!m) return;
    m.style.display = 'none';
    document.body.style.overflow = '';
}
document.getElementById('settingsCloseBtn')?.addEventListener('click', closeSettingsModal);
document.getElementById('settingsModal')?.addEventListener('click', e => {
    if (e.target.id === 'settingsModal') closeSettingsModal();
});

// Tutorial modal chrome (open/close/back live in tutorial.js).
document.getElementById('tutCloseBtn')?.addEventListener('click', closeTutorial);
document.getElementById('tutBackBtn')?.addEventListener('click', tutBack);
document.getElementById('tutorialModal')?.addEventListener('click', e => {
    if (e.target.id === 'tutorialModal') closeTutorial();
});

// --- 9. Event Wiring ---
// Feedback button moved into the actions menu (data-action="feedback") —
// wired via src/wiring.js delegation; no direct button reference here.
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

// History-modal wiring moved into history.js (it owns those DOM refs).

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
        // Numpad sits above every other modal, so it swallows ESC first.
        if (document.getElementById('numpadModal')?.style.display === 'flex') { closeNumpad(); return; }
        // Rating picker sits above the stopwatch modal — swallow ESC before it.
        if (document.getElementById('ieRatingModal')?.style.display === 'flex') { closeIeRatingModal(); return; }
        if (document.getElementById('tutorialModal')?.style.display === 'flex') { tutBack(); return; }
        if (document.getElementById('settingsModal')?.style.display === 'flex') { closeSettingsModal(); return; }
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

// --- 10. Google Analytics 4 (gaTrack lives in state.js so all modules share
// one dispatcher; only the lazy loader stays here.) ---
export function initGA4() {
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
export function loadWebFonts() {
    const href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Thai:wght@400;500;600;700;800'
               + '&family=Noto+Sans+Lao:wght@400;500;600;700&display=swap';
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

// --- 11. Init moved to main.js (entry point). This file exports the
// functions main.js and inline handlers still need — no side effects at
// import time (aside from the top-level DOM ref caches, which are safe
// because <script type="module"> defers until after DOM parse).

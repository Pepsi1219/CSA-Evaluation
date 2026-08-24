// ============================================================
// MAIN — entry point. Loaded as the single <script type="module">
// in index.html. Responsibilities:
//   1. Register the service worker
//   2. Stamp the footer version + install no-zoom guards
//   3. Run app init (theme / GA / restore state / language / calc)
//   4. Wire pagehide / visibilitychange flush
//   5. TEMP: expose handler-referenced functions on window for
//      the inline oninput/onclick attributes still in index.html /
//      chart.js / tutorial.js. Phase 1c removes this bridge together
//      with the inline handlers (data-action + delegation instead).
// ============================================================
import { APP_VERSION } from './version.js';
import { translations } from './translations.js';
import {
    // init functions
    initGA4, initTheme, restoreFormState, restoreStopwatchState,
    _bumpSessionCount, drainFeedbackQueue, showOnboardingIfNeeded,
    changeLanguage, calculateAll, _flushHeavyUpdate, loadWebFonts,
    // functions inline handlers call
    exportCSV, printReport, pwaInstall, toggleTheme,
    openSettingsModal, closeSettingsModal, resetForm, setSamUnit,
    openStopwatchModal, closeStopwatchModal, swSetMode, swStartStop,
    swPauseResume, swLapOrReset, swToggleStatInfo, swContinueTiming,
    swSaveToForm, openTsConfigModal, closeTsConfigModal,
    tsSetConfidence, tsRecalculate, finishOnboarding, onboardNext,
    closeActionsMenu, toggleActionsMenu, openFormulaModal,
    closeFormulaModal, openFeedbackModal, closeFeedbackModal,
    openNumpad, closeNumpad, numpadPress, numpadClear,
} from './app.js';
import { setChartMode } from './chart.js';
import {
    openHistoryModal, closeHistoryModal, openCompareView, handleHistorySave,
} from './history.js';
import {
    openTutorial, tutBack, tutOpenLesson, tutStep, tutStartQuiz,
    tutPick, tutQuizNav, tutGoHome, tutOpenCert, tutGenerateCert,
    tutDownloadCert, updateTutProgressBadge,
} from './tutorial.js';

// --- Service worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// --- Footer version stamp (single source of truth = version.js) ---
const _appVersionEl = document.getElementById('appVersion');
if (_appVersionEl) _appVersionEl.textContent = 'v' + APP_VERSION;

// --- Native-app feel: no zoom (iOS Safari falls through the meta + CSS guards) ---
['gesturestart', 'gesturechange', 'gestureend'].forEach(evt =>
    document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

// --- Init sequence (order matters — matches original script.js bottom block) ---
initGA4();
initTheme();
restoreFormState();
restoreStopwatchState();
_bumpSessionCount();
drainFeedbackQueue();
showOnboardingIfNeeded();
updateTutProgressBadge();
const _savedLang = (() => { try { return localStorage.getItem('csa_lang'); } catch { return null; } })();
changeLanguage(_savedLang && translations[_savedLang] ? _savedLang : 'th');
calculateAll();
_flushHeavyUpdate();
if (document.readyState === 'complete') loadWebFonts();
else window.addEventListener('load', loadWebFonts);

// --- Flush pending debounced saves before hide/unload ---
window.addEventListener('pagehide', _flushHeavyUpdate);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushHeavyUpdate();
});

// ============================================================
// TEMPORARY window.* bridge — inline handlers in index.html /
// chart.js / tutorial.js reference these by bare name. Phase 1c
// refactors those to data-action delegation and this block goes.
// ============================================================
Object.assign(window, {
    // core
    calculateAll, changeLanguage, resetForm,
    // menu / theme / settings
    exportCSV, printReport, pwaInstall, toggleTheme,
    openSettingsModal, closeSettingsModal,
    toggleActionsMenu, closeActionsMenu,
    // SAM unit
    setSamUnit,
    // stopwatch
    openStopwatchModal, closeStopwatchModal,
    swSetMode, swStartStop, swPauseResume, swLapOrReset,
    swToggleStatInfo, swContinueTiming, swSaveToForm,
    // Time Study config
    openTsConfigModal, closeTsConfigModal, tsSetConfidence, tsRecalculate,
    // onboarding
    finishOnboarding, onboardNext,
    // formula modal
    openFormulaModal, closeFormulaModal,
    // feedback
    openFeedbackModal, closeFeedbackModal,
    // numpad
    openNumpad, closeNumpad, numpadPress, numpadClear,
    // history
    openHistoryModal, closeHistoryModal, openCompareView, handleHistorySave,
    // chart
    setChartMode,
    // tutorial
    openTutorial, tutBack, tutOpenLesson, tutStep, tutStartQuiz,
    tutPick, tutQuizNav, tutGoHome, tutOpenCert, tutGenerateCert,
    tutDownloadCert,
});

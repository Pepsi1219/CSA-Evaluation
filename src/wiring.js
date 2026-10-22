// ============================================================
// WIRING — all event binding that used to live in inline
// on* attributes. Imported by main.js after app.js has defined
// everything. Two mechanisms:
//   1. Recalc inputs: bound by id (FORM_FIELD_IDS + tsErrorInput).
//   2. Everything else: one delegated click handler keyed on
//      [data-action] (+ optional [data-arg]) — the same pattern the
//      numpad / formula modal already use.
// ============================================================
import {
    calculateAll, tsRecalculate,
    exportCSV, printReport, pwaInstall, toggleTheme,
    openSettingsModal, openResultPrecisionModal, resetForm, setSamUnit, closeActionsMenu, scrollToTop,
    openToolsModal, closeToolsModal, toolsBack, openDailyCapacityTool, openManpowerTool, clearManpowerData,
    openRestTimeTool, calculateRestTimeUI, saveRestTimeInputs, clearRestTimeData, setRestTimeSamUnit,
    calculateManpowerUI, saveManpowerInputs,
    setManpowerSamUnit,
    setDailyCapacitySamUnit, calculateDailyCapacityUI,
    saveDailyCapacityInputs, clearDailyCapacityData, scrollDailyCapacityPage,
    openDailyCapacityConfig, closeDailyCapacityConfig, setDailyCapacityPeriod,
    openDailyCapacityTimeMenu, setDailyCapacityTimeMenuValue, closeDailyCapacityTimeMenu,
    openDailyCapacityRandomModal, closeDailyCapacityRandomModal, randomizeDailyCapacityActuals,
    markDailyCapacityActualAsManual, deleteDailyCapacityRandomActuals, deleteAllDailyCapacityActuals,
    openStopwatchModal, closeStopwatchModal, swSetMode, swStartStop,
    swPauseResume, swLapOrReset, swToggleStatInfo, swContinueTiming,
    swSaveToForm, swExportPNG, swDeleteLap, swSetSingleRounds, openTsConfigModal, closeTsConfigModal,
    tsSetConfidence, tsApplyPreset, finishOnboarding, onboardNext, openFeedbackModal,
    setTrainCurve,
    ieElemAdd, ieElemDel, ieNudge, ieStart, ieBackToSetup,
    ieStartTimer, iePauseTimer, ieResetTimer,
    ieTap, ieSaveToForm, ieExportPNG, ieSetFlow, ieBackToChooser,
    ieIntroConfirm, ieIntroCancel,
    openIeSamHelp, closeIeSamHelp, openIeCtHelp, closeIeCtHelp,
    openIeRatingModal, closeIeRatingModal, ieRatingNone,
} from './app.js';
import { openHistoryModal } from './history.js';
import { setChartMode } from './chart.js';
import { signOutUser } from './auth.js';
import {
    openTutorial, tutOpenLesson, tutStep, tutStartQuiz, tutPick,
    tutQuizNav, tutGoHome, tutOpenCert, tutGenerateCert, tutDownloadCert,
} from './tutorial.js';

// The 8 form fields whose input recomputes everything, plus the Time
// Study error field. Kept in sync with FORM_FIELD_IDS in app.js.
const RECALC_IDS = ['samInput','effTargetInput','totalMin','totalTime','totalCount','passQty','failQty','duration'];
RECALC_IDS.forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => calculateAll());
});
document.getElementById('tsErrorInput')?.addEventListener('input', () => tsRecalculate());
document.getElementById('swRoundsInput')?.addEventListener('input', () => swSetSingleRounds());
['capacitySamInput', 'capacityEfficiencyInput', 'capacityEndTimeInput', 'capacityWorkersInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        calculateDailyCapacityUI();
        saveDailyCapacityInputs();
    });
});
['manpowerDemandInput', 'manpowerStandardTimeInput', 'manpowerAvailableTimeInput', 'manpowerEfficiencyInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        calculateManpowerUI();
        saveManpowerInputs();
    });
});
['restTimeSamInput', 'restTimeAllowanceInput', 'restTimeWorkInput', 'restTimeAmvInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        calculateRestTimeUI();
        saveRestTimeInputs();
    });
});
document.getElementById('dailyCapacityScheduleBody')?.addEventListener('input', event => {
    const input = event.target.closest('[data-capacity-period]');
    if (input) setDailyCapacityPeriod(Number(input.dataset.capacityPeriod), input.value);
});
document.getElementById('dailyCapacityTableBody')?.addEventListener('input', event => {
    if (event.target.matches('[data-capacity-actual]')) {
        markDailyCapacityActualAsManual(Number(event.target.dataset.capacityActual));
        saveDailyCapacityInputs();
        calculateDailyCapacityUI();
    }
});
document.getElementById('dailyCapacityTableBody')?.addEventListener('change', event => {
    if (event.target.matches('[data-capacity-actual]')) saveDailyCapacityInputs();
});
const syncCapacityRandomPercentageInputs = () => {
    const mode = document.querySelector('input[name="capacityActualRandomMode"]:checked')?.value;
    const belowInput = document.getElementById('capacityActualRandomBelow');
    const aboveInput = document.getElementById('capacityActualRandomAbove');
    if (belowInput) belowInput.disabled = mode === 'above';
    if (aboveInput) aboveInput.disabled = mode === 'below';
};
const updateCapacityRandomPercentageValue = input => {
    const output = document.getElementById(`${input.id}Value`);
    if (output) output.value = `${input.value}%`;
};
document.querySelectorAll('input[name="capacityActualRandomMode"]').forEach(input => {
    input.addEventListener('change', syncCapacityRandomPercentageInputs);
});
['capacityActualRandomBelow', 'capacityActualRandomAbove'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => updateCapacityRandomPercentageValue(input));
    updateCapacityRandomPercentageValue(input);
});
syncCapacityRandomPercentageInputs();
document.getElementById('dailyCapacityRandomModal')?.addEventListener('click', event => {
    if (event.target.id === 'dailyCapacityRandomModal') closeDailyCapacityRandomModal();
    if (!event.target.closest('.capacity-random-delete-menu')) {
        document.getElementById('capacityActualDeleteMenu')?.removeAttribute('open');
    }
});
window.addEventListener('pagehide', () => {
    if (document.getElementById('dailyCapacityPanel')?.style.display !== 'none') saveDailyCapacityInputs();
    if (document.getElementById('manpowerPanel')?.style.display !== 'none') saveManpowerInputs();
    if (document.getElementById('restTimePanel')?.style.display !== 'none') saveRestTimeInputs();
});
['dailyCapacityEff100Toggle', 'dailyCapacityEffToggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', event => {
        const button = event.currentTarget;
        button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
        calculateDailyCapacityUI();
        saveDailyCapacityInputs();
    });
});
document.addEventListener('click', event => {
    const choice = event.target.closest('[data-capacity-time-choice]');
    if (choice) {
        setDailyCapacityTimeMenuValue(choice.dataset.capacityTimeChoice);
        return;
    }
    if (!event.target.closest('#dailyCapacityTimeMenu, .daily-capacity-time-picker')) {
        closeDailyCapacityTimeMenu();
    }
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        const deleteMenu = document.getElementById('capacityActualDeleteMenu');
        if (deleteMenu?.open) {
            deleteMenu.open = false;
            deleteMenu.querySelector('summary')?.focus({ preventScroll: true });
            return;
        }
        closeDailyCapacityTimeMenu(true);
        if (document.getElementById('dailyCapacityRandomModal')?.style.display === 'flex') {
            closeDailyCapacityRandomModal();
        }
    }
});
window.addEventListener('resize', () => closeDailyCapacityTimeMenu());

// Action table. Handlers that take the element's data-arg receive it as
// the sole argument. Menu items that used to also call closeActionsMenu()
// list it explicitly below.
const ACTIONS = {
    // header / actions menu (these close the menu after acting)
    csv:            () => { exportCSV();        closeActionsMenu(); },
    print:          () => { printReport();      closeActionsMenu(); },
    history:        () => { openHistoryModal(); closeActionsMenu(); },
    install:        () => { pwaInstall();       closeActionsMenu(); },
    theme:          () => toggleTheme(),
    'result-precision': () => { openResultPrecisionModal(); closeActionsMenu(); },
    settings:       () => { openSettingsModal(); closeActionsMenu(); },
    reset:          () => { resetForm();        closeActionsMenu(); },
    'tools-open':   () => openToolsModal(),
    'mobile-home':  () => scrollToTop(),
    'tools-back':   () => toolsBack(),
    'daily-capacity-open': () => openDailyCapacityTool(),
    'manpower-open': () => openManpowerTool(),
    'manpower-clear': () => clearManpowerData(),
    'rest-time-open': () => openRestTimeTool(),
    'rest-time-clear': () => clearRestTimeData(),
    'rest-time-sam-unit': arg => setRestTimeSamUnit(arg),
    'manpower-sam-unit': arg => setManpowerSamUnit(arg),
    'daily-capacity-clear': () => clearDailyCapacityData(),
    'daily-capacity-scroll-top': () => scrollDailyCapacityPage('top'),
    'daily-capacity-scroll-bottom': () => scrollDailyCapacityPage('bottom'),
    'capacity-sam-unit': arg => setDailyCapacitySamUnit(arg),
    'daily-capacity-config-open': () => openDailyCapacityConfig(),
    'daily-capacity-config-close': () => closeDailyCapacityConfig(),
    'capacity-actual-random-open': (arg, el) => openDailyCapacityRandomModal(el),
    'capacity-actual-random-close': () => closeDailyCapacityRandomModal(),
    'capacity-actual-random-apply': () => randomizeDailyCapacityActuals(),
    'capacity-actual-random-delete': () => deleteDailyCapacityRandomActuals(),
    'capacity-actual-delete-all': () => deleteAllDailyCapacityActuals(),
    'capacity-time-open': (arg, el) => openDailyCapacityTimeMenu(arg, el),
    // SAM unit toggle
    'sam-unit':     arg => setSamUnit(arg),
    // stopwatch
    'sw-open':      () => openStopwatchModal(),
    'sw-close':     () => closeStopwatchModal(),
    'sw-mode':      arg => swSetMode(arg),
    'sw-lap':       () => swLapOrReset(),
    'sw-pause':     () => swPauseResume(),
    'sw-startstop': () => swStartStop(),
    'sw-stat':      arg => swToggleStatInfo(arg),
    'sw-continue':  () => swContinueTiming(),
    'sw-save':      () => swSaveToForm(),
    'sw-png':       () => swExportPNG(),
    'sw-del-lap':   arg => swDeleteLap(Number(arg)),
    // Time Study config
    'ts-open':      () => openTsConfigModal(),
    'ts-close':     () => closeTsConfigModal(),
    'ts-conf':      arg => tsSetConfidence(Number(arg)),
    'ts-preset':    arg => tsApplyPreset(arg),
    // IE Time Study mode
    'ie-intro-confirm':   () => ieIntroConfirm(),
    'ie-intro-cancel':    () => ieIntroCancel(),
    'ie-sam-help-open':   () => openIeSamHelp(),
    'ie-sam-help-close':  () => closeIeSamHelp(),
    'ie-ct-help-open':    () => openIeCtHelp(),
    'ie-ct-help-close':   () => closeIeCtHelp(),
    'ie-flow':            arg => ieSetFlow(arg),
    'ie-back-to-chooser': () => ieBackToChooser(),
    'ie-elem-add':      () => ieElemAdd(),
    'ie-elem-del':      arg => ieElemDel(Number(arg)),
    'ie-nudge':         arg => ieNudge(arg),
    'ie-start':         () => ieStart(),
    'ie-back-to-setup': () => ieBackToSetup(),
    'ie-start-timer':   () => ieStartTimer(),
    'ie-pause-timer':   () => iePauseTimer(),
    'ie-reset-timer':   () => ieResetTimer(),
    'ie-tap':           () => ieTap(),
    'ie-save':          () => ieSaveToForm(),
    'ie-png':           () => ieExportPNG(),
    'ie-rating-open':   arg => openIeRatingModal(Number(arg)),
    'ie-rating-close':  () => closeIeRatingModal(),
    'ie-rating-none':   () => ieRatingNone(),
    // onboarding
    'onboard-finish': () => finishOnboarding(),
    'onboard-next':   () => onboardNext(),
    // settings → tutorial launcher
    'tutorial-open': () => openTutorial(),
    // feedback (moved from the floating footer button into the actions menu)
    feedback:       () => { openFeedbackModal(); closeActionsMenu(); },
    // account sign-out (onAuthChange → main.js reloads the page).
    // Close the actions menu first so the click doesn't leave it visibly open
    // during the reload transition — matches other menu items' behaviour.
    signout:        () => { closeActionsMenu(); signOutUser(); },
    // chart mode toggle (generated markup in chart.js)
    'chart-mode':   arg => setChartMode(arg),
    // Training-plan curve shape toggle (static markup in index.html)
    'train-curve':  arg => setTrainCurve(arg),
    // tutorial (generated markup in tutorial.js)
    'tut-lesson':   (arg, el) => tutOpenLesson(el.dataset.cat, el.dataset.lesson),
    'tut-step':     arg => tutStep(Number(arg)),
    'tut-quiz-start': () => tutStartQuiz(),
    'tut-pick':     arg => tutPick(Number(arg)),
    'tut-quiz-nav': arg => tutQuizNav(Number(arg)),
    'tut-home':     () => tutGoHome(),
    'tut-cert':     () => tutOpenCert(),
    'tut-cert-gen': () => tutGenerateCert(),
    'tut-cert-download': () => tutDownloadCert(),
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    if (el.dataset.action === 'capacity-actual-random-delete' || el.dataset.action === 'capacity-actual-delete-all') {
        document.getElementById('capacityActualDeleteMenu')?.removeAttribute('open');
    }
    fn(el.dataset.arg, el);
});

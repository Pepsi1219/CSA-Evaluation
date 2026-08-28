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
    openSettingsModal, resetForm, setSamUnit, closeActionsMenu,
    openStopwatchModal, closeStopwatchModal, swSetMode, swStartStop,
    swPauseResume, swLapOrReset, swToggleStatInfo, swContinueTiming,
    swSaveToForm, swDeleteLap, openTsConfigModal, closeTsConfigModal,
    tsSetConfidence, tsApplyPreset, finishOnboarding, onboardNext, openFeedbackModal,
    setTrainCurve,
    ieElemAdd, ieElemDel, ieStart, ieBackToSetup, ieStartStop,
    ieTap, ieUndo, ieSaveToForm,
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
    settings:       () => { openSettingsModal(); closeActionsMenu(); },
    reset:          () => { resetForm();        closeActionsMenu(); },
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
    'sw-del-lap':   arg => swDeleteLap(Number(arg)),
    // Time Study config
    'ts-open':      () => openTsConfigModal(),
    'ts-close':     () => closeTsConfigModal(),
    'ts-conf':      arg => tsSetConfidence(Number(arg)),
    'ts-preset':    arg => tsApplyPreset(arg),
    // IE Time Study mode
    'ie-elem-add':      () => ieElemAdd(),
    'ie-elem-del':      arg => ieElemDel(Number(arg)),
    'ie-start':         () => ieStart(),
    'ie-back-to-setup': () => ieBackToSetup(),
    'ie-startstop':     () => ieStartStop(),
    'ie-tap':           () => ieTap(),
    'ie-undo':          () => ieUndo(),
    'ie-save':          () => ieSaveToForm(),
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
    fn(el.dataset.arg, el);
});

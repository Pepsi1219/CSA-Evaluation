// ============================================================
// HISTORY — saved evaluations + compare table.
// Depends on globals from earlier scripts: t(), currentLang,
// pcsPerHr (i18n), gaTrack (analytics), calcAvgMin / pcsFromEff /
// calcActualEff / calcActualPcsPerHr / calcPassRate (calc.js),
// getSamMinutes (script.js).
//
// Kept as a browser-global module (not ES-module) to stay
// consistent with the other split files and to allow the future
// Firestore backend to swap loadHistory/persistHistory without
// touching consumers.
// ============================================================

const STORAGE_KEY_HISTORY = 'csa_history_v1';
const HISTORY_MAX         = 100;

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g,
        c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---- Storage ----
function loadHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
        const parsed = raw ? JSON.parse(raw) : [];
        // Guard against a corrupted "null"/object payload — always hand back an array.
        return Array.isArray(parsed) ? parsed : [];
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
        note:  '',              // shift handover note — user-editable per entry
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

// Update / write the free-text handover note on a specific entry.
function setHistoryNote(id, note) {
    const list = loadHistory();
    const entry = list.find(e => e.id === id);
    if (!entry) return;
    entry.note = String(note || '').slice(0, 200);
    persistHistory(list);
    gaTrack('history_note_saved', { has_note: !!entry.note });
}

// ---- DOM refs — resolved once at defer-time (DOM already parsed) ----
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
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    const notePreview = e.note
        ? `<div class="history-row-note" title="${escapeHtml(e.note)}">📝 ${escapeHtml(e.note)}</div>`
        : '';
    return `
    <div class="history-row" data-id="${e.id}">
        <label class="history-row-check">
            <input type="checkbox" class="history-check" value="${e.id}">
        </label>
        <div class="history-row-main">
            <div class="history-row-title">${escapeHtml(title)}</div>
            <div class="history-row-meta">${escapeHtml(metaParts.join(' · ') || '—')}</div>
            ${notePreview}
            <button type="button" class="history-note-btn" data-id="${e.id}">
                <span class="lang-text" data-key="${e.note ? 'history_note_edit' : 'history_note_add'}">
                    ${e.note ? t('history_note_edit') : t('history_note_add')}
                </span>
            </button>
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
    historyListEl.querySelectorAll('.history-note-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const entry = loadHistory().find(e => e.id === id);
            const current = entry ? entry.note : '';
            const next = prompt(t('history_note_prompt'), current);
            if (next === null) return;   // cancelled
            setHistoryNote(id, next);
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
        { key: 'history_note', get: e => e.note ? escapeHtml(e.note) : '—' },
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        STORAGE_KEY_HISTORY, HISTORY_MAX,
        escapeHtml, loadHistory, persistHistory,
        saveCurrentToHistory, deleteHistoryEntry, setHistoryNote,
    };
}

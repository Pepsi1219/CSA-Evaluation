// ============================================================
// CHART — hand-built inline SVG learning-curve chart.
// No charting library; draws with CSS var(--...) tokens so it
// re-themes automatically in dark mode.
//
// State is intentionally module-global (same "flat globals"
// pattern the rest of the app uses):
//   _chartCache     — snapshot from calculateAll(): {data,targetPcs,
//                     effTarget,currentEff,currentPcs}
//   _chartAnimated  — one-shot flag; the line draws in via
//                     stroke-dashoffset on the first paint of a
//                     training-plan session, then stays static so
//                     keystroke-driven re-renders don't flicker.
//                     Reset when the training grid clears.
//   chartMode       — 'pcs' | 'eff' toggle
//
// ============================================================
import { currentLang, pcsPerHr, t } from './state.js';

let chartMode      = 'pcs'; // 'pcs' | 'eff'
let _chartCache    = { data: [], targetPcs: 0, effTarget: 0 };
let _chartAnimated = false;

// Setters/getter (app.js needs to reassign the cache wholesale on each
// calculateAll(); the one-shot animation flag resets when the grid clears).
export function setChartCache(next) { _chartCache = next; }
export function resetChartAnimation() { _chartAnimated = false; }

export function setChartMode(mode) {
    chartMode = mode;
    renderChartFromCache();
}

export function renderChartFromCache() {
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
                    data-action="chart-mode" data-arg="pcs" ${!hasPcs ? 'disabled' : ''}>${pcsLabel}</button>
            <button class="chart-toggle-btn ${!isPcs ? 'active' : ''}"
                    data-action="chart-mode" data-arg="eff">Eff %</button>
        </div>
    </div>
    ${renderSVGChart(values, target, unit)}`;
}

export function renderSVGChart(values, target, unit) {
    const n = values.length;
    if (n === 0) return '';

    const W = 400, H = 180;
    const p = { t: 10, r: 18, b: 22, l: 30 };
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

    // Line — animated on first paint (once per training-plan session).
    // Approximate path length: sum segment lengths in SVG units.
    const linePath = values.map((d, i) => `${i===0?'M':'L'} ${x(i)} ${y(d.value)}`).join(' ');
    let pathLen = 0;
    for (let i = 1; i < n; i++) {
        const dx = x(i) - x(i - 1);
        const dy = y(values[i].value) - y(values[i - 1].value);
        pathLen += Math.hypot(dx, dy);
    }
    pathLen = Math.max(1, Math.round(pathLen));
    const lineClass = _chartAnimated ? '' : ' class="chart-line-anim"';
    const lineStyle = _chartAnimated ? '' : ` style="stroke-dasharray:${pathLen};stroke-dashoffset:${pathLen};"`;
    const line = `<path d="${linePath}" fill="none" stroke="var(--accent-500)"
                       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${lineClass}${lineStyle}/>`;
    _chartAnimated = true;

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

    // X labels — every unit (1, 2, 3, ...)
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

    // Accessible name for screen readers — the chart is otherwise a wall of
    // decorative <path>/<text> nodes with no semantic meaning.
    const ariaLabel = t('chart_aria');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;"
                 role="img" aria-label="${ariaLabel}">
        <title>${ariaLabel}</title>
        ${yTicks}${area}${targetSvg}${line}${dots}${axes}${xLabels}
    </svg>`;
}

// ============================================================
// TIMEUTIL — pure time-formatting + Time Study helpers.
// No DOM. Loaded before script.js in the browser; also
// require()-able from Node for unit tests (test/timeutil.test.js).
// ============================================================

// Format ms → MM:SS.cs  (centiseconds)
function fmtSw(ms) {
    const t  = Math.max(0, Math.floor(ms / 1000));
    const m  = Math.floor(t / 60);
    const s  = t % 60;
    const cs = Math.floor((Math.abs(ms) % 1000) / 10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// Format ms → seconds with 2 decimals (mean / general stats)
function fmtSec2(ms) { return (Math.abs(ms) / 1000).toFixed(2); }
// Format ms → seconds with 4 decimals (SD — needs finer precision)
function fmtSec4(ms) { return (Math.abs(ms) / 1000).toFixed(4); }

// Snap raw ms to the display resolution (10 ms = 2-decimal seconds).
// Storing laps at this resolution guarantees stats calculated from stored
// values match what the user sees on screen and would hand-calc.
function snapLapMs(ms) { return Math.round(ms / 10) * 10; }

// T-distribution — two-tailed critical values.
// Rows: [df, t@90%, t@95%, t@99%]. df > 30 falls back to df = 30.
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

function tsTValue(df, confidence) {
    if (df < 1) return null;
    const capped = Math.min(df, 30);
    const row = T_TABLE.find(r => r[0] === capped);
    const idx = confidence === 90 ? 1 : (confidence === 99 ? 3 : 2);
    return row ? row[idx] : null;
}

// Compute Time Study required sample size N from raw laps (ms).
// Returns { n, mean, sd, tVal, df, N_raw, N } or null when n < 2.
// Uses sample SD (n-1, Bessel) to pair correctly with the t-distribution.
function computeSampleSize(lapsMs, confidence, errorPercent) {
    if (!Array.isArray(lapsMs) || lapsMs.length < 2) return null;
    const n = lapsMs.length;
    const mean = lapsMs.reduce((a, b) => a + b, 0) / n;
    const variance = lapsMs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
    const sd = Math.sqrt(variance);
    const df = n - 1;
    const tVal = tsTValue(df, confidence);
    const eRatio = errorPercent / 100;
    const N_raw = mean > 0 ? Math.pow((tVal * sd) / (eRatio * mean), 2) : 0;
    return { n, mean, sd, df, tVal, N_raw, N: Math.ceil(N_raw) };
}

// ---- CSV helpers (RFC 4180) ----
// Quote when the cell contains a comma, double-quote, or newline; double
// embedded quotes. Null/undefined become the empty cell.
function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells) { return cells.map(csvEscape).join(','); }
function csvBuild(rows) {
    // Prepend UTF-8 BOM so Excel opens Thai characters correctly.
    return '﻿' + rows.map(csvRow).join('\r\n');
}

export {
    fmtSw, fmtSec2, fmtSec4, snapLapMs,
    T_TABLE, tsTValue, computeSampleSize,
    csvEscape, csvRow, csvBuild,
};

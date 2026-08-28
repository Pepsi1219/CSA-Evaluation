// ============================================================
// IE — pure Time Study calc: Westinghouse Performance Rating,
// continuous-timing element split, Normal / Standard Time,
// and Maytag/T sample-size sufficiency. No DOM.
// Consumed by app.js (IE mode UI) and test/ie.test.js.
// ============================================================
import { computeSampleSize } from './timeutil.js';

// Westinghouse 4-factor rating table — decimals added to 1.00.
// D/D/D/D → 1.00 (Normal Pace). Values from Niebel/Freivalds Motion & Time Study.
export const WESTINGHOUSE = Object.freeze({
    skill: Object.freeze({
        A1:  0.15, A2:  0.13,
        B1:  0.11, B2:  0.08,
        C1:  0.06, C2:  0.03,
        D:   0.00,
        E1: -0.05, E2: -0.10,
        F1: -0.16, F2: -0.22,
    }),
    effort: Object.freeze({
        A1:  0.13, A2:  0.12,
        B1:  0.10, B2:  0.08,
        C1:  0.05, C2:  0.02,
        D:   0.00,
        E1: -0.04, E2: -0.08,
        F1: -0.12, F2: -0.17,
    }),
    conditions: Object.freeze({
        A:  0.06, B:  0.04, C:  0.02, D: 0.00, E: -0.03, F: -0.07,
    }),
    consistency: Object.freeze({
        A:  0.04, B:  0.03, C:  0.01, D: 0.00, E: -0.02, F: -0.04,
    }),
});

// Qualitative labels per rank — drives the rating-picker UI. The label slugs
// resolve to translation keys `ie_rating_lbl_<slug>` in translations.js, so a
// slug added here needs a matching key in all 4 languages (translations.test
// enforces parity). Niebel's Effort table uses "Excessive" for A1/A2, not
// "Superskill" — keep those distinct.
export const WESTINGHOUSE_LABELS = Object.freeze({
    skill: Object.freeze({
        A1: 'superskill', A2: 'superskill',
        B1: 'excellent',  B2: 'excellent',
        C1: 'good',       C2: 'good',
        D:  'avg',
        E1: 'fair',       E2: 'fair',
        F1: 'poor',       F2: 'poor',
    }),
    effort: Object.freeze({
        A1: 'excessive', A2: 'excessive',
        B1: 'excellent', B2: 'excellent',
        C1: 'good',      C2: 'good',
        D:  'avg',
        E1: 'fair',      E2: 'fair',
        F1: 'poor',      F2: 'poor',
    }),
    conditions: Object.freeze({
        A: 'ideal', B: 'excellent', C: 'good', D: 'avg', E: 'fair', F: 'poor',
    }),
    consistency: Object.freeze({
        A: 'perfect', B: 'excellent', C: 'good', D: 'avg', E: 'fair', F: 'poor',
    }),
});

// Compose a Westinghouse rating factor from 4 rank codes.
// Missing / unknown code → treat as D (0). Result is `1 + Σadjustments`.
// D/D/D/D → 1.00 exactly; positive values speed a fast operator, negative slow.
export function ratingFactor(rank) {
    const r = rank || {};
    const pick = (table, code) => (Object.prototype.hasOwnProperty.call(table, code) ? table[code] : 0);
    return 1
        + pick(WESTINGHOUSE.skill,       r.ws  ?? 'D')
        + pick(WESTINGHOUSE.effort,      r.we  ?? 'D')
        + pick(WESTINGHOUSE.conditions,  r.wc  ?? 'D')
        + pick(WESTINGHOUSE.consistency, r.wcon ?? 'D');
}

// Split a Continuous-Timing reading list into per-element / per-cycle times.
// `readings` = cumulative ms values from Start, one per tap. Start itself
// (t=0) is implicit and NOT stored — the first reading is the end of
// element 1 of cycle 1. `nElements` = elements per cycle (N).
//
// Returns `number[cycle][element]` (ms differences). Any trailing readings
// that don't complete a full cycle are ignored so the matrix stays
// rectangular. When N is 0 or readings is empty the result is [].
export function elementTimesFromReadings(readings, nElements) {
    if (!Array.isArray(readings) || !(nElements > 0)) return [];
    const cycles = Math.floor(readings.length / nElements);
    const out = [];
    for (let c = 0; c < cycles; c++) {
        const row = new Array(nElements);
        for (let e = 0; e < nElements; e++) {
            const idx = c * nElements + e;
            const prev = idx === 0 ? 0 : readings[idx - 1];
            row[e] = readings[idx] - prev;
        }
        out.push(row);
    }
    return out;
}

// Descriptive stats for one element's observed times (ms).
// Sample SD (Bessel's n-1) to pair with the t-distribution downstream.
// Returns null when there is nothing to describe (n === 0).
export function elementStats(timesMs) {
    if (!Array.isArray(timesMs) || timesMs.length === 0) return null;
    const n = timesMs.length;
    const sum = timesMs.reduce((a, b) => a + b, 0);
    const sumSq = timesMs.reduce((a, b) => a + b * b, 0);
    const mean = sum / n;
    const variance = n > 1
        ? timesMs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1)
        : 0;
    const sd = Math.sqrt(variance);
    return { n, mean, sd, sum, sumSq };
}

// Normal Time = observed mean × rating factor.
export function normalTimeMs(meanMs, rf) {
    return meanMs * rf;
}

// Standard Time = Normal Time / (1 − A). `allowancePct` is the SUM of the
// P/F/D buckets, expressed in percent (e.g. 15 means 15% total).
// Clamped so an accidental 100+ doesn't divide by zero or go negative.
export function standardTimeMs(ntMs, allowancePct) {
    const a = Math.max(0, Math.min(95, Number(allowancePct) || 0)) / 100;
    return ntMs / (1 - a);
}

// Maytag / General Electric sample-size shortcut for 95% / ±5%:
//   N' = ( 40 · √(n·Σx² − (Σx)²) / Σx )²
// 40 = t(∞, 95%) / 0.05 ≈ 40 (rounded from 39.2). Returns Math.ceil(N').
// Returns 0 when data is insufficient or the sum is 0 (avoid /0).
export function maytagN(sum, sumSq, n) {
    if (!(n >= 2) || !(sum > 0)) return 0;
    const inner = n * sumSq - sum * sum;
    if (!(inner > 0)) return 0;
    const raw = Math.pow((40 * Math.sqrt(inner)) / sum, 2);
    return Math.ceil(raw);
}

// Wrapper around computeSampleSize so callers can use one seam for T-based N.
// Passes the raw element times through unchanged. Returns null when n < 2.
export function sampleSizeT(timesMs, confidence = 95, errorPercent = 5) {
    return computeSampleSize(timesMs, confidence, errorPercent);
}

// Convenience: given all per-cycle element times, allowances, and per-element
// rating rank, compute a full study summary. Returns rows per element +
// study totals in ms. `elementTimes` is the shape returned by
// elementTimesFromReadings; `ranks` is `Array<{ws,we,wc,wcon}>` in the same
// element order; `allowance` = {personal, fatigue, delay} in %.
export function computeStudy(elementTimes, ranks, allowance) {
    const nElements = ranks.length;
    const cycles = elementTimes.length;
    const totalAllowance =
        (Number(allowance?.personal) || 0)
        + (Number(allowance?.fatigue) || 0)
        + (Number(allowance?.delay)   || 0);

    const rows = [];
    let totalNT = 0;
    let totalST = 0;

    for (let e = 0; e < nElements; e++) {
        // Column e of the matrix — one entry per cycle for this element.
        const times = [];
        for (let c = 0; c < cycles; c++) {
            const v = elementTimes[c]?.[e];
            if (Number.isFinite(v)) times.push(v);
        }
        const stats = elementStats(times);
        const rf = ratingFactor(ranks[e]);
        const mean = stats ? stats.mean : 0;
        const sd   = stats ? stats.sd   : 0;
        const nt = normalTimeMs(mean, rf);
        const st = standardTimeMs(nt, totalAllowance);
        const nMay = stats ? maytagN(stats.sum, stats.sumSq, stats.n) : 0;
        const tRes = stats ? sampleSizeT(times, 95, 5) : null;
        const nT   = tRes ? tRes.N : 0;

        rows.push({
            index: e,
            n: stats?.n ?? 0,
            meanMs: mean,
            sdMs: sd,
            rf,
            ntMs: nt,
            stMs: st,
            requiredNMaytag: nMay,
            requiredNT: nT,
        });
        totalNT += nt;
        totalST += st;
    }

    return {
        cycles,
        totalAllowancePct: totalAllowance,
        rows,
        totalNormalMs: totalNT,
        totalStandardMs: totalST,
    };
}

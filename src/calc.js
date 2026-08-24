// Copyright (c) 2025 Pongsathon. All rights reserved.
// Proprietary — see LICENSE. Do not copy, redistribute, or reverse engineer.
// ============================================================
// CALC — pure calculation functions, no DOM dependencies.
// Loaded before script.js in the browser; also require()-able
// directly from Node for unit tests (see test/calc.test.js).
// ============================================================

// Parse a user-typed number, tolerating a comma decimal separator.
// The SAM input's HTML pattern permits a comma (common in TH/VN/LA locales),
// but plain parseFloat("0,5") returns 0 — silently zeroing the whole calc.
// Normalize the first comma to a dot, then parse. Returns NaN for blank/junk
// so each caller keeps its own fallback (usually `|| 0`).
function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return NaN;
    return parseFloat(String(v).replace(',', '.'));
}

// Pieces/hour achievable at a given SAM and efficiency %.
// Returns 0 when inputs can't produce a valid result (sam<=0 or eff<=0).
function pcsFromEff(sam, effPercent) {
    if (!(sam > 0) || !(effPercent > 0)) return 0;
    return Math.round((60 / sam) * (effPercent / 100));
}

// Average cycle time in minutes from recorded total time + rep count.
// Returns null when there isn't enough data to compute it.
function calcAvgMin(totalMin, totalSec, totalCount) {
    if (!(totalCount > 0) || !(totalMin > 0 || totalSec > 0)) return null;
    return ((totalMin * 60) + totalSec) / totalCount / 60;
}

// Actual efficiency % from SAM and measured average cycle time (minutes).
function calcActualEff(sam, avgMin) {
    if (!(sam > 0) || !(avgMin > 0)) return null;
    return Math.round((sam / avgMin) * 100);
}

// Target cycle time (minutes/piece) needed to hit a target efficiency %,
// given the SAM. e.g. SAM 0.456 at 60% -> 0.76 min (45.6 sec) per piece.
// Returns null when inputs can't produce a valid result (sam<=0 or eff<=0).
function newSamFromEff(sam, effPercent) {
    if (!(sam > 0) || !(effPercent > 0)) return null;
    return sam / (effPercent / 100);
}

// Actual output in pieces/hour from measured average cycle time (minutes).
function calcActualPcsPerHr(avgMin) {
    if (!(avgMin > 0)) return null;
    return Math.round(60 / avgMin);
}

// Pass rate % from pass/fail quantities. Null when there's no quantity yet.
function calcPassRate(passQty, failQty) {
    const totalQty = passQty + failQty;
    if (!(totalQty > 0)) return null;
    // Floor deliberately — never overstate yield in a QMS-facing report:
    // 999/1000 = 99.9% must not round up to 100%.
    return Math.floor((passQty / totalQty) * 100);
}

// One day/hour of the training (learning-curve) plan.
function calcTrainingDay(currentEff, gap, duration, day, sam) {
    const eff = Math.round(currentEff + (gap / duration * day));
    const pcs = pcsFromEff(sam, eff);
    return { day, eff, pcs };
}

export {
    parseNum,
    pcsFromEff,
    calcAvgMin,
    calcActualEff,
    newSamFromEff,
    calcActualPcsPerHr,
    calcPassRate,
    calcTrainingDay,
};

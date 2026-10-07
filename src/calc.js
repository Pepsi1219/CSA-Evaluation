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

// Daily capacity from standard minutes/piece, efficiency, available
// production minutes, and headcount. Keep fractional pieces through the
// aggregate calculation; rounding each worker separately understates output.
function calcDailyCapacity(samMinutes, effPercent, workingMinutes, workers) {
    if (!(samMinutes > 0) || !(effPercent > 0) || !(workingMinutes > 0) || !(workers > 0)) {
        return { perHour: 0, total: 0 };
    }
    const total = (workingMinutes / samMinutes) * (effPercent / 100) * workers;
    const perHour = total / (workingMinutes / 60);
    return { perHour, total };
}

// Sum productive minutes across an hourly schedule for a wall-clock window.
// Partial periods use that period's configured productive-minute ratio.
function calcScheduledWorkMinutes(periods, startMinute, endMinute) {
    if (!Array.isArray(periods) || periods.length !== 12
        || !periods.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 60)
        || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
        || startMinute < 0 || startMinute > 24 * 60 || endMinute < 0 || endMinute > 24 * 60) return null;
    const scheduleStart = 8 * 60;
    const scheduleEnd = 20 * 60;
    const start = Math.max(startMinute, scheduleStart);
    const end = Math.min(endMinute, scheduleEnd);
    if (end <= start) return 0;
    let total = 0;
    for (let index = 0; index < periods.length; index += 1) {
        const periodStart = scheduleStart + index * 60;
        const overlap = Math.max(0, Math.min(end, periodStart + 60) - Math.max(start, periodStart));
        total += overlap * periods[index] / 60;
    }
    return total;
}

function calcDailyTarget(targetPerHour, productiveMinutes) {
    if (!(targetPerHour > 0) || !Number.isFinite(targetPerHour)
        || !(productiveMinutes > 0) || !Number.isFinite(productiveMinutes)) return null;
    return targetPerHour * productiveMinutes / 60;
}

// Convert the two fields of a clock-style recovery duration into hours.
// Keep minutes bounded to a real clock field so 1 h 30 min is unambiguous.
function calcRecoveryRemainingHours(hours, minutes) {
    if (!Number.isSafeInteger(hours) || hours < 0
        || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 59) return null;
    const totalHours = hours + minutes / 60;
    return totalHours > 0 ? totalHours : null;
}

// Compare a requested daily target with the current calculated capacity.
// Recovery rounds a positive daily gap upward to a whole piece.
function calcRecoveryProgress(currentPerHour, currentDailyOutput, targetDailyOutput, targetPerHour, totalWorkingHours, remainingHours) {
    if (!(currentPerHour > 0) || !Number.isFinite(currentPerHour)
        || !(currentDailyOutput > 0) || !Number.isFinite(currentDailyOutput)
        || !(targetDailyOutput > 0) || !Number.isFinite(targetDailyOutput)
        || !(targetPerHour > 0) || !Number.isFinite(targetPerHour)
        || !(totalWorkingHours > 0) || !Number.isFinite(totalWorkingHours)
        || !(remainingHours >= 0) || !Number.isFinite(remainingHours)
        || remainingHours > totalWorkingHours) return null;
    const dailyGap = targetDailyOutput - currentDailyOutput;
    const hourlyGap = targetPerHour - currentPerHour;
    const deficit = Math.max(0, Math.ceil(dailyGap - 1e-9));
    return { dailyGap, hourlyGap, deficit };
}

// Recovery uses the baseline unrounded hourly target and the requested-target gap.
function calcCapacityRecovery(samMinutes, effPercent, workers, deficitPieces, remainingHours) {
    if (!(samMinutes > 0) || !Number.isFinite(samMinutes)
        || !(effPercent > 0) || !Number.isFinite(effPercent)
        || !(workers > 0) || !Number.isSafeInteger(workers)
        || !Number.isSafeInteger(deficitPieces) || deficitPieces < 0
        || !(remainingHours > 0) || !Number.isFinite(remainingHours)) return null;
    const deficit = deficitPieces;
    const targetPerHour = calcDailyCapacity(samMinutes, effPercent, 60, workers).perHour;
    const requiredPerHour = targetPerHour + deficit / remainingHours;
    const requiredEfficiency = requiredPerHour * samMinutes / (60 * workers) * 100;
    const otMinutes = deficit === 0 ? 0 : Math.max(1, Math.ceil(deficit / targetPerHour * 60 - 1e-9));
    if (![targetPerHour, requiredPerHour, requiredEfficiency, otMinutes].every(Number.isFinite)) return null;
    return {
        deficit, targetPerHour, requiredPerHour, requiredEfficiency, otMinutes,
        withinNormalTime: requiredEfficiency <= 100 + 1e-9,
    };
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
//
// `curve` picks the interpolation shape between anchor (currentEff) and
// global target (currentEff + gap):
//   'scurve'  — Hermite smoothstep progress = 3t² − 2t³.
//               Rises slowly at first, fastest in the middle, plateaus at
//               the end. Matches how operators actually pick up a task
//               (warm-up → peak learning → plateau near mastery).
//   'linear'  — flat rate = gap / duration per day. Simple / conservative.
// Default is 'scurve' so first-time users see the realistic shape without
// having to pick anything; the UI exposes a toggle to switch to 'linear'.
function calcTrainingDay(currentEff, gap, duration, day, sam, curve = 'scurve') {
    if (!(duration > 0) || !(day > 0)) {
        return { day, eff: currentEff, pcs: pcsFromEff(sam, currentEff) };
    }
    const globalEff = currentEff + gap;
    let eff;
    if (curve === 'linear') {
        eff = Math.round(currentEff + (gap / duration * day));
    } else {
        const t = Math.min(day / duration, 1);
        const progress = t * t * (3 - 2 * t);  // Hermite smoothstep
        eff = Math.round(currentEff + gap * progress);
    }
    // Floating-point drift can overshoot the target by 1 in the last day;
    // cap to global so a "day = duration" row never reads N+1%.
    if (gap > 0 && eff > globalEff) eff = globalEff;
    return { day, eff, pcs: pcsFromEff(sam, eff) };
}

export {
    parseNum,
    pcsFromEff,
    calcDailyCapacity,
    calcScheduledWorkMinutes,
    calcDailyTarget,
    calcRecoveryRemainingHours,
    calcRecoveryProgress,
    calcCapacityRecovery,
    calcAvgMin,
    calcActualEff,
    newSamFromEff,
    calcActualPcsPerHr,
    calcPassRate,
    calcTrainingDay,
};

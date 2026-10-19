import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseNum,
    pcsFromEff,
    calcAvgMin,
    calcActualEff,
    newSamFromEff,
    calcActualPcsPerHr,
    calcPassRate,
    calcTrainingDay,
    calcDailyCapacity,
    calcScheduledWorkMinutes,
    randomizeTargetPieces,
    calcDailyTarget,
    calcRecoveryRemainingHours,
    calcRecoveryProgress,
    calcCapacityRecovery,
} from '../src/calc.js';

test('parseNum', async (t) => {
    await t.test('parses a plain decimal string', () => {
        assert.equal(parseNum('0.456'), 0.456);
        assert.equal(parseNum('12'), 12);
    });
    await t.test('accepts a comma as the decimal separator (TH/VN/LA locales)', () => {
        // The SAM input pattern permits a comma; plain parseFloat would return 0.
        assert.equal(parseNum('0,456'), 0.456);
        assert.equal(parseNum('45,67'), 45.67);
    });
    await t.test('passes numbers through unchanged', () => {
        assert.equal(parseNum(3.5), 3.5);
    });
    await t.test('returns NaN for blank/garbage so callers keep their own fallback', () => {
        assert.ok(Number.isNaN(parseNum('')));
        assert.ok(Number.isNaN(parseNum('abc')));
        assert.ok(Number.isNaN(parseNum(null)));
        assert.ok(Number.isNaN(parseNum(undefined)));
    });
});

test('pcsFromEff', async (t) => {
    await t.test('computes pieces/hour at a given SAM and efficiency %', () => {
        assert.equal(pcsFromEff(0.5, 100), 120);
        assert.equal(pcsFromEff(1, 80), 48);
    });
    await t.test('returns 0 when sam is invalid', () => {
        assert.equal(pcsFromEff(0, 100), 0);
        assert.equal(pcsFromEff(-1, 100), 0);
    });
    await t.test('returns 0 when effPercent is invalid', () => {
        assert.equal(pcsFromEff(0.5, 0), 0);
        assert.equal(pcsFromEff(0.5, -10), 0);
    });
});

test('calcDailyCapacity', async t => {
    await t.test('calculates daily total and equivalent hourly output', () => {
        assert.deepEqual(calcDailyCapacity(0.5, 100, 480, 10), {
            perHour: 1200,
            total: 9600,
        });
        assert.deepEqual(calcDailyCapacity(0.5, 80, 480, 3), {
            perHour: 288,
            total: 2304,
        });
    });
    await t.test('preserves fractional pieces across the full workforce', () => {
        const capacity = calcDailyCapacity(740 / 60, 100, 480, 21);
        assert.ok(Math.abs(capacity.total - (8 * 3600 * 21 / 740)) < 1e-10);
        assert.ok(Math.abs(capacity.total - 817.2972972972973) < 1e-10);
        assert.ok(Math.abs(capacity.perHour - (capacity.total / 8)) < 1e-10);
        assert.ok(Math.abs(capacity.perHour - 102.16216216216216) < 1e-10);
    });
    await t.test('returns zero capacity for invalid or non-positive inputs', () => {
        assert.deepEqual(calcDailyCapacity(0, 100, 480, 10), { perHour: 0, total: 0 });
        assert.deepEqual(calcDailyCapacity(0.5, 0, 480, 10), { perHour: 0, total: 0 });
        assert.deepEqual(calcDailyCapacity(0.5, 100, 0, 10), { perHour: 0, total: 0 });
        assert.deepEqual(calcDailyCapacity(0.5, 100, 480, 0), { perHour: 0, total: 0 });
    });
});

test('calcScheduledWorkMinutes', async t => {
    const periods = [60, 60, 60, 30, 30, 60, 60, 60, 60, 30, 60, 30];
    await t.test('sums configured productive minutes and handles partial periods', () => {
        assert.equal(calcScheduledWorkMinutes(periods, 8 * 60, 17 * 60), 480);
        assert.equal(calcScheduledWorkMinutes(periods, 8 * 60, 20 * 60), 600);
        assert.equal(calcScheduledWorkMinutes(periods, 16 * 60 + 30, 17 * 60), 30);
        assert.equal(calcScheduledWorkMinutes(periods, 17 * 60, 17 * 60 + 30), 15);
    });
    await t.test('returns zero outside the configured schedule and rejects invalid data', () => {
        assert.equal(calcScheduledWorkMinutes(periods, 17 * 60, 17 * 60), 0);
        assert.equal(calcScheduledWorkMinutes(periods, 20 * 60, 21 * 60), 0);
        assert.equal(calcScheduledWorkMinutes([...periods, 60], 8 * 60, 17 * 60), null);
        assert.equal(calcScheduledWorkMinutes(periods, 17 * 60, 8 * 60), 0);
    });
});

test('randomizeTargetPieces', async t => {
    await t.test('randomizes below and above target within the configured maximum', () => {
        assert.equal(randomizeTargetPieces(100, 'below', 20, 15, () => 0.5), 90);
        assert.equal(randomizeTargetPieces(100, 'above', 20, 15, () => 0.5), 108);
    });
    await t.test('mixed mode chooses a side per call and never returns a negative quantity', () => {
        const belowRandom = [0.25, 0.5];
        assert.equal(randomizeTargetPieces(100, 'mixed', 20, 10, () => belowRandom.shift()), 90);
        const aboveRandom = [0.75, 0.5];
        assert.equal(randomizeTargetPieces(100, 'mixed', 20, 10, () => aboveRandom.shift()), 105);
        assert.equal(randomizeTargetPieces(1, 'below', 100, 10, () => 1), 0);
    });
    await t.test('rejects invalid targets, modes, and percentage limits', () => {
        assert.equal(randomizeTargetPieces(-1, 'below', 10, 10), null);
        assert.equal(randomizeTargetPieces(100, 'random', 10, 10), null);
        assert.equal(randomizeTargetPieces(100, 'below', 101, 10), null);
        assert.equal(randomizeTargetPieces(100, 'above', 10, NaN), null);
    });
});

test('calcDailyTarget', async t => {
    await t.test('derives daily target from hourly target and productive hours', () => {
        assert.equal(calcDailyTarget(95, 600), 950);
    });
    await t.test('rejects invalid target or schedule values', () => {
        assert.equal(calcDailyTarget(0, 600), null);
        assert.equal(calcDailyTarget(95, 0), null);
        assert.equal(calcDailyTarget(95, NaN), null);
    });
});

test('calcCapacityRecovery', async t => {
    await t.test('divides the remaining daily gap across remaining hours', () => {
        const result = calcCapacityRecovery(0.48, 80, 1, 60, 2);
        assert.equal(result.deficit, 60);
        assert.equal(result.targetPerHour, 100);
        assert.equal(result.requiredPerHour, 30);
        assert.ok(Math.abs(result.requiredEfficiency - 24) < 1e-9);
        assert.equal(result.otMinutes, 36);
        assert.equal(result.withinNormalTime, true);
        const fractional = calcCapacityRecovery(0.48, 80, 1, 831.91, 2);
        assert.equal(fractional.requiredPerHour, 415.955);
        assert.ok(Math.abs(fractional.requiredEfficiency - 332.764) < 1e-9);
    });
    await t.test('calculates a feasible efficiency and rounds OT up to full minutes', () => {
        const result = calcCapacityRecovery(0.6, 80, 1, 120, 3);
        assert.equal(result.targetPerHour, 80);
        assert.equal(result.requiredPerHour, 40);
        assert.equal(result.requiredEfficiency, 40);
        assert.equal(result.otMinutes, 90);
        assert.equal(result.withinNormalTime, true);
        const feasible = calcCapacityRecovery(0.6, 70, 1, 10, 2);
        assert.equal(feasible.withinNormalTime, true);
        assert.equal(calcCapacityRecovery(0.6, 80, 1, 0, 2).otMinutes, 0);
        const afterShift = calcCapacityRecovery(0.6, 80, 1, 10, 0);
        assert.equal(afterShift.requiredPerHour, null);
        assert.equal(afterShift.requiredEfficiency, null);
        assert.equal(afterShift.otMinutes, 8);
    });
    await t.test('rejects invalid inputs instead of showing an impossible plan', () => {
        assert.equal(calcCapacityRecovery(0, 80, 1, 10, 2), null);
        assert.equal(calcCapacityRecovery(0.6, 0, 1, 10, 2), null);
        assert.equal(calcCapacityRecovery(0.6, 80, 1.5, 10, 2), null);
        assert.equal(calcCapacityRecovery(0.6, 80, 1, -1, 2), null);
        assert.equal(calcCapacityRecovery(0.6, 80, 1, NaN, 2), null);
    });
});

test('calcRecoveryRemainingHours', async t => {
    await t.test('converts a clock-style duration to fractional hours', () => {
        assert.equal(calcRecoveryRemainingHours(1, 30), 1.5);
        assert.equal(calcRecoveryRemainingHours(0, 30), 0.5);
        assert.equal(calcRecoveryRemainingHours(2, 0), 2);
    });
    await t.test('requires a positive duration with minute values on a clock', () => {
        assert.equal(calcRecoveryRemainingHours(0, 0), null);
        assert.equal(calcRecoveryRemainingHours(1, 60), null);
        assert.equal(calcRecoveryRemainingHours(1, -1), null);
        assert.equal(calcRecoveryRemainingHours(1.5, 0), null);
    });
});

test('calcRecoveryProgress', async t => {
    await t.test('keeps daily remainder separate from behind-schedule recovery', () => {
        const progress = calcRecoveryProgress(103, 103, 827.93, 103, 1, 6);
        assert.ok(Math.abs(progress.dailyGap - 724.93) < 1e-9);
        assert.equal(progress.hourlyGap, 0);
        assert.equal(progress.expectedOutputToDate, 103);
        assert.equal(progress.deficit, 0);
    });
    await t.test('calculates only the shortfall against the plan through elapsed hours', () => {
        const progress = calcRecoveryProgress(90, 180, 827.93, 103, 2, 5);
        assert.ok(Math.abs(progress.dailyGap - 647.93) < 1e-9);
        assert.equal(progress.hourlyGap, 13);
        assert.equal(progress.expectedOutputToDate, 206);
        assert.equal(progress.deficit, 26);
    });
    await t.test('does not request recovery when desired capacity is lower', () => {
        const progress = calcRecoveryProgress(201.6, 1612.8, 1500, 187.5, 8, 4);
        assert.ok(progress.dailyGap < 0);
        assert.ok(progress.hourlyGap < 0);
        assert.equal(progress.deficit, 0);
    });
    await t.test('rejects invalid target or shift data', () => {
        assert.equal(calcRecoveryProgress(0, 1600, 1800, 225, 8, 3), null);
        assert.equal(calcRecoveryProgress(100, 1600, 0, 225, 8, 3), null);
        assert.equal(calcRecoveryProgress(100, 1600, 1800, 225, 8, -1), null);
    });
});

test('calcAvgMin', async (t) => {
    await t.test('computes average cycle time in minutes', () => {
        assert.equal(calcAvgMin(1, 0, 2), 0.5);
        assert.equal(calcAvgMin(0, 30, 1), 0.5);
    });
    await t.test('handles fractional seconds (stopwatch saves 10 ms resolution)', () => {
        // 45.67 s over 1 round → 0.7611666… min. The seconds field now carries
        // decimals, so this precision must survive into the calc.
        assert.ok(Math.abs(calcAvgMin(0, 45.67, 1) - 45.67 / 60) < 1e-9);
        assert.ok(Math.abs(calcAvgMin(1, 5.5, 2) - 65.5 / 2 / 60) < 1e-9);
    });
    await t.test('returns null when count is missing', () => {
        assert.equal(calcAvgMin(1, 0, 0), null);
    });
    await t.test('returns null when there is no recorded time', () => {
        assert.equal(calcAvgMin(0, 0, 5), null);
    });
});

test('calcActualEff', async (t) => {
    await t.test('computes efficiency % from SAM and avg cycle time', () => {
        assert.equal(calcActualEff(0.5, 0.5), 100);
        assert.equal(calcActualEff(0.4, 0.5), 80);
        assert.equal(calcActualEff(0.5, 0.55), 100 / 1.1);
    });
    await t.test('returns null when sam or avgMin is invalid', () => {
        assert.equal(calcActualEff(0, 0.5), null);
        assert.equal(calcActualEff(0.5, 0), null);
        assert.equal(calcActualEff(0.5, null), null);
    });
});

test('newSamFromEff', async (t) => {
    await t.test('computes target cycle time (minutes) at a target efficiency %', () => {
        assert.equal(newSamFromEff(0.456, 60), 0.76);   // 0.76 min = 45.6 sec
        assert.equal(newSamFromEff(0.5, 100), 0.5);
        assert.equal(newSamFromEff(0.4, 80), 0.5);
    });
    await t.test('returns null when sam or effPercent is invalid', () => {
        assert.equal(newSamFromEff(0, 75), null);
        assert.equal(newSamFromEff(0.5, 0), null);
        assert.equal(newSamFromEff(-1, 75), null);
    });
});

test('calcActualPcsPerHr', async (t) => {
    await t.test('computes output pieces/hour from avg cycle time', () => {
        assert.equal(calcActualPcsPerHr(0.5), 120);
        assert.equal(calcActualPcsPerHr(1), 60);
        assert.equal(calcActualPcsPerHr(0.55), 60 / 0.55);
    });
    await t.test('returns null when avgMin is invalid', () => {
        assert.equal(calcActualPcsPerHr(0), null);
        assert.equal(calcActualPcsPerHr(-1), null);
    });
});

test('calcPassRate', async (t) => {
    await t.test('computes pass rate % from pass/fail quantities', () => {
        assert.equal(calcPassRate(80, 20), 80);
        assert.equal(calcPassRate(1, 0), 100);
    });
    await t.test('returns null when there is no quantity yet', () => {
        assert.equal(calcPassRate(0, 0), null);
    });
});

test('calcTrainingDay', async (t) => {
    await t.test("linear ('linear'): flat rate across the training duration", () => {
        // current 60%, target 100% (gap 40), over 4 days → +10%/day
        assert.deepEqual(
            calcTrainingDay(60, 40, 4, 1, 0.5, 'linear'),
            { day: 1, eff: 70, pcs: pcsFromEff(0.5, 70) },
        );
        assert.deepEqual(
            calcTrainingDay(60, 40, 4, 4, 0.5, 'linear'),
            { day: 4, eff: 100, pcs: pcsFromEff(0.5, 100) },
        );
    });

    await t.test('pcs is 0 when sam is invalid (linear)', () => {
        assert.deepEqual(
            calcTrainingDay(60, 40, 4, 1, 0, 'linear'),
            { day: 1, eff: 70, pcs: 0 },
        );
    });

    await t.test("s-curve ('scurve') is the default when no curve arg is passed", () => {
        // Default (no 6th arg) must equal explicit 'scurve'.
        assert.deepEqual(
            calcTrainingDay(40, 35, 14, 5, 0.5),
            calcTrainingDay(40, 35, 14, 5, 0.5, 'scurve'),
        );
    });

    await t.test('s-curve: starts slow, peaks in the middle, ends at target', () => {
        // Hermite smoothstep 3t² − 2t³ on start=40, target=75 (gap=35), 14 days.
        // Endpoint pinning + monotonicity are the load-bearing properties.
        const start = 40, gap = 35, dur = 14, sam = 0.5;
        const last  = calcTrainingDay(start, gap, dur, dur, sam);
        assert.equal(last.eff, start + gap, 'last day must hit the target exactly');

        const d1 = calcTrainingDay(start, gap, dur, 1,  sam).eff;
        const d7 = calcTrainingDay(start, gap, dur, 7,  sam).eff;
        const dN = last.eff;
        // Day 1 rises slowly (< linear's step of 2.5), day 7 sits near midpoint.
        assert.ok(d1 - start <= 2, `day 1 should barely move (got +${d1 - start})`);
        assert.ok(d7 >= 55 && d7 <= 61, `day 7 should be near midpoint (got ${d7})`);
        assert.equal(dN, 75, 'day N equals target');

        // Monotone non-decreasing across the whole plan.
        let prev = -Infinity;
        for (let i = 1; i <= dur; i++) {
            const e = calcTrainingDay(start, gap, dur, i, sam).eff;
            assert.ok(e >= prev, `eff must never decrease (day ${i}: ${e} < ${prev})`);
            prev = e;
        }
    });

    await t.test('s-curve: matches user spec sample (anchor 7.1%, target 80%, 15 days)', () => {
        // Values from the S-curve spec table the user provided (rounded to
        // integer %). anchor rounded to 7 in our int-eff model.
        const day = (d) => calcTrainingDay(7, 73, 15, d, 0.5).eff;
        assert.equal(day(15), 80, 'day 15 hits target');
        // Rough shape checks — s-curve, not linear.
        assert.ok(day(1) < 15, 'day 1 still near anchor');
        assert.ok(day(8) > 40 && day(8) < 55, 'day 8 well past midpoint');
    });

    await t.test('degenerate inputs (day 0 / duration 0) return the anchor', () => {
        assert.equal(calcTrainingDay(60, 40, 0, 1, 0.5).eff, 60);
        assert.equal(calcTrainingDay(60, 40, 4, 0, 0.5).eff, 60);
    });
});

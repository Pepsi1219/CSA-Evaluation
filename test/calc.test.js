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

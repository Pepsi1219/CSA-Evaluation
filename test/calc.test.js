const test = require('node:test');
const assert = require('node:assert/strict');
const {
    pcsFromEff,
    calcAvgMin,
    calcActualEff,
    newSamFromEff,
    calcActualPcsPerHr,
    calcPassRate,
    calcTrainingDay,
} = require('../calc.js');

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
    await t.test('interpolates efficiency linearly across the training duration', () => {
        // current 60%, target 100% (gap 40), over 4 days → +10%/day
        assert.deepEqual(calcTrainingDay(60, 40, 4, 1, 0.5), { day: 1, eff: 70, pcs: pcsFromEff(0.5, 70) });
        assert.deepEqual(calcTrainingDay(60, 40, 4, 4, 0.5), { day: 4, eff: 100, pcs: pcsFromEff(0.5, 100) });
    });
    await t.test('pcs is 0 when sam is invalid', () => {
        assert.deepEqual(calcTrainingDay(60, 40, 4, 1, 0), { day: 1, eff: 70, pcs: 0 });
    });
});

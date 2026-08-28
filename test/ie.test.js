import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WESTINGHOUSE, ratingFactor,
    elementTimesFromReadings, elementStats,
    normalTimeMs, standardTimeMs, maytagN, sampleSizeT,
    computeStudy,
} from '../src/ie.js';

// ---------------------------------------------------------------
// ratingFactor — Westinghouse composite
// ---------------------------------------------------------------
test('ratingFactor', async t => {
    await t.test('D/D/D/D = 1.00 (Normal Pace)', () => {
        assert.equal(ratingFactor({ ws:'D', we:'D', wc:'D', wcon:'D' }), 1);
    });
    await t.test('missing rank defaults to D', () => {
        assert.equal(ratingFactor({}), 1);
        assert.equal(ratingFactor(null), 1);
        assert.equal(ratingFactor(undefined), 1);
    });
    await t.test('B1 skill only → 1.11', () => {
        assert.equal(
            +ratingFactor({ ws:'B1', we:'D', wc:'D', wcon:'D' }).toFixed(4),
            1.11
        );
    });
    await t.test('classic Niebel example B1/C1/C/C = 1.19', () => {
        // Skill B1 +0.11, Effort C1 +0.05, Conditions C +0.02, Consistency C +0.01
        const v = ratingFactor({ ws:'B1', we:'C1', wc:'C', wcon:'C' });
        assert.equal(+v.toFixed(4), 1.19);
    });
    await t.test('all F2/F/F → slowest', () => {
        // Skill F2 -0.22, Effort F2 -0.17, Conditions F -0.07, Consistency F -0.04
        const v = ratingFactor({ ws:'F2', we:'F2', wc:'F', wcon:'F' });
        assert.equal(+v.toFixed(4), 0.5);
    });
    await t.test('unknown code treated as D', () => {
        assert.equal(ratingFactor({ ws:'ZZ', we:'D', wc:'D', wcon:'D' }), 1);
    });
});

test('WESTINGHOUSE table is frozen and has expected shape', () => {
    assert.equal(Object.isFrozen(WESTINGHOUSE), true);
    assert.equal(WESTINGHOUSE.skill.D, 0);
    assert.equal(WESTINGHOUSE.effort.D, 0);
    assert.equal(WESTINGHOUSE.conditions.D, 0);
    assert.equal(WESTINGHOUSE.consistency.D, 0);
    assert.equal(WESTINGHOUSE.skill.A1, 0.15);
    assert.equal(WESTINGHOUSE.effort.F2, -0.17);
});

// ---------------------------------------------------------------
// elementTimesFromReadings — Continuous Timing split
// ---------------------------------------------------------------
test('elementTimesFromReadings', async t => {
    await t.test('single cycle, 3 elements', () => {
        // taps at 5s, 12s, 20s
        const out = elementTimesFromReadings([5000, 12000, 20000], 3);
        assert.deepEqual(out, [[5000, 7000, 8000]]);
    });
    await t.test('two cycles, 2 elements', () => {
        // c1: 3s, 8s | c2: +4s (12s), +6s (18s)
        const out = elementTimesFromReadings([3000, 8000, 12000, 18000], 2);
        assert.deepEqual(out, [[3000, 5000], [4000, 6000]]);
    });
    await t.test('trailing partial cycle is dropped', () => {
        // 5 readings, 2 elements per cycle → 2 full cycles, drop trailing 1
        const out = elementTimesFromReadings([2, 5, 8, 12, 15], 2);
        assert.deepEqual(out, [[2, 3], [3, 4]]);
    });
    await t.test('empty readings → []', () => {
        assert.deepEqual(elementTimesFromReadings([], 3), []);
    });
    await t.test('nElements 0 → []', () => {
        assert.deepEqual(elementTimesFromReadings([1, 2, 3], 0), []);
    });
    await t.test('sum of one cycle equals its last reading (continuous)', () => {
        const readings = [4321, 9876, 15432, 20000];
        const [row] = elementTimesFromReadings(readings, 4);
        const sum = row.reduce((a, b) => a + b, 0);
        assert.equal(sum, 20000);
    });
});

// ---------------------------------------------------------------
// elementStats
// ---------------------------------------------------------------
test('elementStats', async t => {
    await t.test('empty → null', () => {
        assert.equal(elementStats([]), null);
        assert.equal(elementStats(null), null);
    });
    await t.test('single value → mean, sd=0', () => {
        const s = elementStats([1000]);
        assert.equal(s.n, 1);
        assert.equal(s.mean, 1000);
        assert.equal(s.sd, 0);
        assert.equal(s.sum, 1000);
        assert.equal(s.sumSq, 1000 * 1000);
    });
    await t.test('sample SD (Bessel n-1)', () => {
        // laps 1000, 2000, 3000 → mean 2000, sample SD 1000
        const s = elementStats([1000, 2000, 3000]);
        assert.equal(s.mean, 2000);
        assert.equal(+s.sd.toFixed(6), 1000);
    });
});

// ---------------------------------------------------------------
// normalTimeMs / standardTimeMs
// ---------------------------------------------------------------
test('normalTimeMs & standardTimeMs', async t => {
    await t.test('NT = mean × rf', () => {
        assert.equal(normalTimeMs(0.8 * 60000, 1.20), 0.96 * 60000);
    });
    await t.test('ST = NT / (1 − A) — Niebel example 15% → 0.96/0.85', () => {
        const st = standardTimeMs(0.96 * 60000, 15);
        assert.equal(+((st / 60000).toFixed(4)), 1.1294);
    });
    await t.test('ST with 0% allowance = NT', () => {
        assert.equal(standardTimeMs(1000, 0), 1000);
    });
    await t.test('ST clamps allowance ≥ 95% (guard against divide-by-zero)', () => {
        // 95% → 20×; anything above is clamped to 95
        const a = standardTimeMs(100, 99);
        const b = standardTimeMs(100, 95);
        assert.equal(a, b);
    });
    await t.test('ST treats negative allowance as 0', () => {
        assert.equal(standardTimeMs(500, -20), 500);
    });
});

// ---------------------------------------------------------------
// maytagN — 95% / ±5% shortcut
// ---------------------------------------------------------------
test('maytagN', async t => {
    await t.test('zero variance → 0 (nothing more to sample)', () => {
        // All 10 values equal → n*Σx² − (Σx)² = 0
        const s = elementStats([500, 500, 500, 500]);
        assert.equal(maytagN(s.sum, s.sumSq, s.n), 0);
    });
    await t.test('n < 2 → 0', () => {
        assert.equal(maytagN(1000, 1e6, 1), 0);
    });
    await t.test('spread data → positive N (should ceil up)', () => {
        // laps 4, 5, 6, 7, 8 seconds (in ms) — small dataset, high variance
        const times = [4000, 5000, 6000, 7000, 8000];
        const s = elementStats(times);
        const n = maytagN(s.sum, s.sumSq, s.n);
        assert.ok(n > 0, 'expected positive required N');
        assert.equal(Number.isInteger(n), true);
    });
    await t.test('sum=0 guard', () => {
        assert.equal(maytagN(0, 0, 5), 0);
    });
});

// ---------------------------------------------------------------
// sampleSizeT wrapper
// ---------------------------------------------------------------
test('sampleSizeT delegates to computeSampleSize', () => {
    const r = sampleSizeT([4000, 5000, 6000, 7000, 8000], 95, 5);
    assert.ok(r);
    assert.equal(r.n, 5);
    assert.ok(r.N > 0);
});
test('sampleSizeT returns null when n < 2', () => {
    assert.equal(sampleSizeT([1000], 95, 5), null);
});

// ---------------------------------------------------------------
// computeStudy — end-to-end
// ---------------------------------------------------------------
test('computeStudy — full IE calc', async t => {
    // 2 cycles × 2 elements: [[10s, 5s], [11s, 6s]]
    const times = [
        [10000, 5000],
        [11000, 6000],
    ];
    const ranks = [
        { ws:'D', we:'D', wc:'D', wcon:'D' },   // rf 1.00
        { ws:'B1', we:'D', wc:'D', wcon:'D' },  // rf 1.11
    ];
    const allowance = { personal: 5, fatigue: 5, delay: 5 };  // 15%
    const s = computeStudy(times, ranks, allowance);

    await t.test('cycle count', () => assert.equal(s.cycles, 2));
    await t.test('total allowance summed', () => assert.equal(s.totalAllowancePct, 15));

    await t.test('element 0 (D/D/D/D)', () => {
        const r = s.rows[0];
        assert.equal(r.n, 2);
        assert.equal(r.meanMs, 10500);
        assert.equal(r.rf, 1);
        assert.equal(r.ntMs, 10500);
        // ST = NT / 0.85
        assert.equal(+r.stMs.toFixed(2), +(10500 / 0.85).toFixed(2));
    });
    await t.test('element 1 (skill B1)', () => {
        const r = s.rows[1];
        assert.equal(r.meanMs, 5500);
        assert.equal(+r.rf.toFixed(4), 1.11);
        assert.equal(+r.ntMs.toFixed(4), +(5500 * 1.11).toFixed(4));
    });
    await t.test('totals = Σ per-element', () => {
        const sumNT = s.rows.reduce((a, r) => a + r.ntMs, 0);
        const sumST = s.rows.reduce((a, r) => a + r.stMs, 0);
        assert.equal(+s.totalNormalMs.toFixed(4), +sumNT.toFixed(4));
        assert.equal(+s.totalStandardMs.toFixed(4), +sumST.toFixed(4));
    });
});

test('computeStudy with 1 cycle → sd 0, no required-N', () => {
    const s = computeStudy([[5000, 6000]], [{}, {}], { personal: 0, fatigue: 0, delay: 0 });
    assert.equal(s.rows[0].sdMs, 0);
    assert.equal(s.rows[0].requiredNMaytag, 0);
    assert.equal(s.rows[0].requiredNT, 0);
});

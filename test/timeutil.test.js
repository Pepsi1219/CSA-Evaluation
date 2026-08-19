const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    fmtSw, fmtSec2, fmtSec4, snapLapMs,
    T_TABLE, tsTValue, computeSampleSize,
    csvEscape, csvRow, csvBuild,
} = require('../timeutil.js');

// ---------------------------------------------------------------
// fmtSw — MM:SS.cs display
// ---------------------------------------------------------------
test('fmtSw', async t => {
    await t.test('zero → 00:00.00', () => {
        assert.equal(fmtSw(0), '00:00.00');
    });
    await t.test('sub-second rounds down (centiseconds)', () => {
        assert.equal(fmtSw(1567), '00:01.56');
    });
    await t.test('crosses one minute', () => {
        assert.equal(fmtSw(60000), '01:00.00');
    });
    await t.test('negative ms clamps to zero seconds portion', () => {
        // Guard against startTs skew
        assert.equal(fmtSw(-500), '00:00.50');
    });
    await t.test('large duration (>10 minutes)', () => {
        assert.equal(fmtSw(614250), '10:14.25');
    });
});

// ---------------------------------------------------------------
// fmtSec2 / fmtSec4 — seconds with fixed decimals
// ---------------------------------------------------------------
test('fmtSec2', async t => {
    await t.test('millisecond precision → 2 decimals', () => {
        assert.equal(fmtSec2(1567), '1.57');
        assert.equal(fmtSec2(0),     '0.00');
        assert.equal(fmtSec2(999),   '1.00');
    });
});
test('fmtSec4', async t => {
    await t.test('SD precision — 4 decimals', () => {
        assert.equal(fmtSec4(1567),  '1.5670');
        assert.equal(fmtSec4(135.77), '0.1358');
    });
});

// ---------------------------------------------------------------
// snapLapMs — display-resolution snapping
// ---------------------------------------------------------------
test('snapLapMs', async t => {
    await t.test('rounds to nearest 10 ms', () => {
        assert.equal(snapLapMs(1567), 1570);
        assert.equal(snapLapMs(1564), 1560);
        assert.equal(snapLapMs(1565), 1570); // banker's tie-break rounds up
        assert.equal(snapLapMs(0),    0);
    });
    await t.test('stored value equals what fmtSw would display', () => {
        // After snapping, floor and round give the same result
        const snapped = snapLapMs(1567);          // 1570
        assert.equal(fmtSw(snapped), '00:01.57');
    });
});

// ---------------------------------------------------------------
// T-distribution table — spot-check known values from standard tables
// ---------------------------------------------------------------
test('T_TABLE integrity', async t => {
    await t.test('has 30 rows for df 1..30', () => {
        assert.equal(T_TABLE.length, 30);
        for (let i = 0; i < 30; i++) assert.equal(T_TABLE[i][0], i + 1);
    });
    await t.test('critical values monotonically decrease as df grows', () => {
        for (let i = 1; i < T_TABLE.length; i++) {
            assert.ok(T_TABLE[i][2] < T_TABLE[i - 1][2],
                `t95 at df=${i + 1} should be < df=${i}`);
        }
    });
});

test('tsTValue', async t => {
    await t.test('standard reference values', () => {
        assert.equal(tsTValue(1,  95), 12.7062);
        assert.equal(tsTValue(2,  95),  4.3027);
        assert.equal(tsTValue(9,  95),  2.2622);
        assert.equal(tsTValue(30, 95),  2.0423);
    });
    await t.test('different confidence levels', () => {
        assert.equal(tsTValue(10, 90), 1.8125);
        assert.equal(tsTValue(10, 95), 2.2281);
        assert.equal(tsTValue(10, 99), 3.1693);
    });
    await t.test('unknown confidence defaults to 95', () => {
        assert.equal(tsTValue(10, 42), 2.2281);
    });
    await t.test('df > 30 caps at df=30', () => {
        assert.equal(tsTValue(100, 95), tsTValue(30, 95));
    });
    await t.test('df < 1 returns null', () => {
        assert.equal(tsTValue(0, 95), null);
    });
});

// ---------------------------------------------------------------
// computeSampleSize — the Time Study credibility feature
// Reference example (from earlier hand-check):
//   Laps: [1560, 1510, 1710, 1960] ms (snapped 2-decimal seconds)
//   x̄ = 1685 ms   SD = 202.07 ms   df = 3
//   t(95%,3) = 3.1824    e = 0.05
//   N = ((3.1824 × 202.07) / (0.05 × 1685))² ≈ 58.26  → 59
// ---------------------------------------------------------------
test('computeSampleSize', async t => {
    await t.test('happy path matches hand-calc', () => {
        const r = computeSampleSize([1560, 1510, 1710, 1960], 95, 5);
        assert.equal(r.n,  4);
        assert.equal(r.df, 3);
        assert.equal(r.mean, 1685);
        assert.ok(Math.abs(r.sd - 202.07) < 0.5, `sd was ${r.sd}`);
        assert.equal(r.tVal, 3.1824);
        assert.ok(Math.abs(r.N_raw - 58.26) < 0.5, `N_raw was ${r.N_raw}`);
        assert.equal(r.N, 59);
    });

    await t.test('n < 2 returns null (insufficient pilot data)', () => {
        assert.equal(computeSampleSize([],       95, 5), null);
        assert.equal(computeSampleSize([1000],   95, 5), null);
        assert.equal(computeSampleSize(null,     95, 5), null);
    });

    await t.test('identical laps → N_raw = 0 (zero variance)', () => {
        const r = computeSampleSize([2000, 2000, 2000], 95, 5);
        assert.equal(r.N_raw, 0);
        assert.equal(r.N,     0);
    });

    await t.test('tighter error requirement → larger N', () => {
        const loose = computeSampleSize([1560, 1510, 1710, 1960], 95, 10);
        const tight = computeSampleSize([1560, 1510, 1710, 1960], 95, 2);
        assert.ok(tight.N > loose.N, 'tighter error should need more cycles');
    });

    await t.test('higher confidence → larger N', () => {
        const c90 = computeSampleSize([1560, 1510, 1710, 1960], 90, 5);
        const c99 = computeSampleSize([1560, 1510, 1710, 1960], 99, 5);
        assert.ok(c99.N > c90.N, 'higher confidence should need more cycles');
    });

    await t.test('sample SD (n-1) not population SD (n)', () => {
        // For [1, 2, 3] mean=2, sample-var = ((1)²+(0)²+(1)²)/(3-1) = 1  → SD=1
        //                       pop-var    =                          /(3)   = 0.667 → SD≈0.816
        const r = computeSampleSize([1000, 2000, 3000], 95, 5);
        assert.ok(Math.abs(r.sd - 1000) < 0.001, `expected sample SD 1000, got ${r.sd}`);
    });
});

// ---------------------------------------------------------------
// CSV helpers — RFC 4180 escaping + BOM for Excel Thai support
// ---------------------------------------------------------------
test('csvEscape', async t => {
    await t.test('plain string passes through', () => {
        assert.equal(csvEscape('hello'), 'hello');
    });
    await t.test('null / undefined → empty cell', () => {
        assert.equal(csvEscape(null),      '');
        assert.equal(csvEscape(undefined), '');
    });
    await t.test('quotes cell containing comma', () => {
        assert.equal(csvEscape('a,b'), '"a,b"');
    });
    await t.test('quotes and double-escapes cell containing double-quote', () => {
        assert.equal(csvEscape('she said "hi"'), '"she said ""hi"""');
    });
    await t.test('quotes cell containing newline', () => {
        assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
    });
    await t.test('preserves Thai characters as-is', () => {
        assert.equal(csvEscape('ค่า SAM'), 'ค่า SAM');
    });
    await t.test('number → string', () => {
        assert.equal(csvEscape(42), '42');
        assert.equal(csvEscape(0),  '0');
    });
});

test('csvRow', async t => {
    await t.test('joins cells with comma', () => {
        assert.equal(csvRow(['a', 'b', 'c']), 'a,b,c');
    });
    await t.test('handles mixed types + escaping', () => {
        assert.equal(csvRow(['name', 'a,b', 42, null]), 'name,"a,b",42,');
    });
});

test('csvBuild', async t => {
    await t.test('prepends UTF-8 BOM for Excel', () => {
        const out = csvBuild([['a']]);
        assert.equal(out.charCodeAt(0), 0xFEFF);
    });
    await t.test('joins rows with CRLF', () => {
        const out = csvBuild([['a', 'b'], ['c', 'd']]);
        assert.equal(out, '﻿' + 'a,b\r\nc,d');
    });
    await t.test('empty row → empty line (blank separator for sections)', () => {
        const out = csvBuild([['a'], [], ['b']]);
        assert.equal(out, '﻿' + 'a\r\n\r\nb');
    });
});

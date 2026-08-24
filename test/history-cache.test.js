import test from 'node:test';
import assert from 'node:assert/strict';

// mergeHistorySnapshot is the pure core of the Firestore history cache:
// dedupe by id (last wins) → sort ts desc → cap at HISTORY_MAX. It's imported
// from auth.js, which pulls in the firebase SDK at module load — so we import
// just the function and never call any Firebase API here.
import { mergeHistorySnapshot } from '../src/auth.js';
import { HISTORY_MAX } from '../src/state.js';

const entry = (id, ts, extra = {}) => ({ id, ts, ...extra });

test('mergeHistorySnapshot', async (t) => {
    await t.test('sorts by ts descending', () => {
        const out = mergeHistorySnapshot([
            entry('a', 100), entry('b', 300), entry('c', 200),
        ]);
        assert.deepEqual(out.map(e => e.id), ['b', 'c', 'a']);
    });

    await t.test('dedupes by id, last occurrence wins', () => {
        const out = mergeHistorySnapshot([
            entry('a', 100, { note: 'old' }),
            entry('a', 100, { note: 'new' }),
            entry('b', 50),
        ]);
        assert.equal(out.length, 2);
        const a = out.find(e => e.id === 'a');
        assert.equal(a.note, 'new');
    });

    await t.test('caps at HISTORY_MAX, keeping the newest', () => {
        const many = Array.from({ length: HISTORY_MAX + 25 },
            (_, i) => entry(`id_${i}`, i));   // ts = i, so higher i = newer
        const out = mergeHistorySnapshot(many);
        assert.equal(out.length, HISTORY_MAX);
        // Newest (highest ts) kept; oldest dropped.
        assert.equal(out[0].ts, HISTORY_MAX + 24);
        assert.equal(out[out.length - 1].ts, 25);
    });

    await t.test('ignores null/id-less entries', () => {
        const out = mergeHistorySnapshot([
            null, undefined, {}, entry('a', 10),
        ]);
        assert.deepEqual(out.map(e => e.id), ['a']);
    });

    await t.test('treats a missing ts as 0 (sorts last, never throws)', () => {
        const out = mergeHistorySnapshot([entry('a'), entry('b', 5)]);
        assert.deepEqual(out.map(e => e.id), ['b', 'a']);
    });

    await t.test('empty input → empty array', () => {
        assert.deepEqual(mergeHistorySnapshot([]), []);
    });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLegacyOwner, mergeTutorialProgress, prepareAccountLocalState } from '../src/auth.js';

// mergeTutorialProgress is the pure reconciliation core used at first sign-in
// (local ⨯ cloud) and any later cross-device merge. Progress must only grow:
// done becomes a union, quiz keeps the better result, cert keeps whichever
// was issued first. auth.js pulls in the firebase SDK but we import only
// this helper and never call any Firebase API here.

test('mergeTutorialProgress', async (t) => {
    await t.test('done is a union — once done, always done', () => {
        const a = { done: { overview: true, sam: true } };
        const b = { done: { sam: true, formula: true } };
        const out = mergeTutorialProgress(a, b);
        assert.equal(out.done.overview, true);
        assert.equal(out.done.sam, true);
        assert.equal(out.done.formula, true);
        assert.equal(mergeTutorialProgress({ done: { sam: true } }, { done: { sam: false } }).done.sam, true);
        assert.equal(mergeTutorialProgress({ done: { sam: false } }, { done: { sam: true } }).done.sam, true);
    });

    await t.test('quiz — passed side wins over not-passed', () => {
        const a = { quiz: { passed: false, pct: 90 } };
        const b = { quiz: { passed: true,  pct: 80 } };
        const out = mergeTutorialProgress(a, b);
        assert.equal(out.quiz.passed, true);
        assert.equal(out.quiz.pct, 80);
    });

    await t.test('quiz — same pass state → higher pct wins', () => {
        const a = { quiz: { passed: true, pct: 85 } };
        const b = { quiz: { passed: true, pct: 92 } };
        const out = mergeTutorialProgress(a, b);
        assert.equal(out.quiz.pct, 92);
    });
    await t.test('quiz uses the stored best score and certificate issue time', () => {
        const a = {
            quiz: { passed: true, best: 80 },
            cert: { id: 'IEC-LATE', at: 2000 },
        };
        const b = {
            quiz: { passed: true, best: 95 },
            cert: { id: 'IEC-EARLY', at: 1000 },
        };
        const out = mergeTutorialProgress(a, b);
        assert.equal(out.quiz.best, 95);
        assert.equal(out.cert.id, 'IEC-EARLY');
        assert.equal(mergeTutorialProgress(b, a).cert.id, 'IEC-EARLY');
    });
    await t.test('legacy pct and ts records remain comparable', () => {
        const old = { quiz: { passed: true, pct: 90 }, cert: { id: 'old', ts: 1000 } };
        const current = { quiz: { passed: true, best: 85 }, cert: { id: 'new', at: 2000 } };
        const out = mergeTutorialProgress(old, current);
        assert.equal(out.quiz.pct, 90);
        assert.equal(out.cert.id, 'old');
    });
    await t.test('equal scores and issue times resolve in the same order on both devices', () => {
        const a = { quiz: { best: 90, passed: true, at: 5 }, cert: { id: 'IEC-B', at: 100 } };
        const b = { quiz: { passed: true, at: 5, best: 90 }, cert: { id: 'IEC-A', at: 100 } };
        assert.deepEqual(mergeTutorialProgress(a, b), mergeTutorialProgress(b, a));
        assert.equal(mergeTutorialProgress(a, b).cert.id, 'IEC-A');
    });

    await t.test('quiz — only one side has a quiz, keep it', () => {
        const only = { quiz: { passed: true, pct: 90 } };
        assert.equal(mergeTutorialProgress({}, only).quiz.pct, 90);
        assert.equal(mergeTutorialProgress(only, {}).quiz.pct, 90);
        assert.equal(mergeTutorialProgress({}, {}).quiz, null);
    });

    await t.test('cert — earliest ts wins (first issue is canonical)', () => {
        const a = { cert: { id: 'IEC-A', name: 'Alice', ts: 1000 } };
        const b = { cert: { id: 'IEC-B', name: 'Alice', ts: 2000 } };
        assert.equal(mergeTutorialProgress(a, b).cert.id, 'IEC-A');
        assert.equal(mergeTutorialProgress(b, a).cert.id, 'IEC-A');
    });

    await t.test('cert — only one side has a cert, keep it', () => {
        const only = { cert: { id: 'IEC-Z', name: 'Bob', ts: 500 } };
        assert.equal(mergeTutorialProgress({}, only).cert.id, 'IEC-Z');
        assert.equal(mergeTutorialProgress(only, {}).cert.id, 'IEC-Z');
        assert.equal(mergeTutorialProgress({}, {}).cert, null);
    });

    await t.test('null / undefined inputs are safe', () => {
        const out = mergeTutorialProgress(null, undefined);
        assert.deepEqual(out, { done: {}, quiz: null, cert: null });
    });

    await t.test('idempotent — merging with self returns self', () => {
        const p = {
            done: { overview: true, sam: true },
            quiz: { passed: true, pct: 88 },
            cert: { id: 'IEC-X', name: 'Alice', ts: 1500 },
        };
        const out = mergeTutorialProgress(p, p);
        assert.deepEqual(out.done, p.done);
        assert.deepEqual(out.quiz, p.quiz);
        assert.deepEqual(out.cert, p.cert);
    });
});

test('legacy local data is claimed by one account only', () => {
    const data = new Map();
    const storage = {
        get length() { return data.size; },
        key: i => [...data.keys()][i] ?? null,
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key),
    };
    assert.equal(claimLegacyOwner(storage, 'alice', 'tutorial'), true);
    assert.equal(claimLegacyOwner(storage, 'alice', 'tutorial'), true);
    assert.equal(claimLegacyOwner(storage, 'bob', 'tutorial'), false);
    data.clear();
    data.set('csa_migrated_alice', '1');
    assert.equal(claimLegacyOwner(storage, 'bob', 'history'), false);
    assert.equal(claimLegacyOwner(storage, 'alice', 'history'), true);
});

test('form and timer state follows the confirmed account on a shared phone', () => {
    const data = new Map([
        ['csa_form_v1', 'Alice form'],
        ['csa_stopwatch_v1', 'Alice stopwatch'],
    ]);
    const storage = {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key),
    };
    assert.equal(prepareAccountLocalState(storage, 'alice', true), false);
    assert.equal(prepareAccountLocalState(storage, 'bob'), true);
    assert.equal(storage.getItem('csa_form_v1'), null);
    assert.equal(storage.getItem('csa_form_v1_alice'), 'Alice form');
    storage.setItem('csa_form_v1', 'Bob form');
    assert.equal(prepareAccountLocalState(storage, 'alice'), true);
    assert.equal(storage.getItem('csa_form_v1'), 'Alice form');
    assert.equal(storage.getItem('csa_form_v1_bob'), 'Bob form');
});

test('unowned legacy state is preserved without assigning it to a fresh login', () => {
    const data = new Map([['csa_ie_v1', 'unknown study']]);
    const storage = {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key),
    };
    prepareAccountLocalState(storage, 'bob', false);
    assert.equal(storage.getItem('csa_ie_v1'), null);
    assert.equal(storage.getItem('csa_ie_v1_legacy_unclaimed'), 'unknown study');
});

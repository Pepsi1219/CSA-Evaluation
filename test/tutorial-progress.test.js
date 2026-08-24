import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTutorialProgress } from '../src/auth.js';

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

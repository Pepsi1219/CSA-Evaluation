const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TUTORIAL_DATA, QUIZ_DATA, QUIZ_PASS_PCT, _letterSpace } = require('../tutorial.js');
const IMG_DIR = path.join(__dirname, '..', 'assets', 'tutorial');

// Every localized content object must at least carry a non-empty Thai string
// (the L() fallback language). Missing `th` would render blank in the app.
function assertHasThai(obj, where) {
    assert.ok(obj && typeof obj === 'object', `${where}: not an object`);
    assert.ok(typeof obj.th === 'string' && obj.th.trim().length > 0, `${where}: missing/empty th`);
}

test('tutorial lessons', async (t) => {
    const seen = new Set();
    await t.test('categories and lessons are well-formed with unique ids', () => {
        for (const cat of TUTORIAL_DATA) {
            assert.ok(cat.id, 'category missing id');
            assertHasThai(cat.title, `cat ${cat.id} title`);
            assertHasThai(cat.desc, `cat ${cat.id} desc`);
            assert.ok(cat.lessons.length > 0, `cat ${cat.id} has no lessons`);
            for (const les of cat.lessons) {
                assert.ok(!seen.has(les.id), `duplicate lesson id ${les.id}`);
                seen.add(les.id);
                assertHasThai(les.title, `lesson ${les.id} title`);
                assert.ok(les.steps.length > 0, `lesson ${les.id} has no steps`);
                for (const st of les.steps) assertHasThai(st.cap, `lesson ${les.id} caption`);
            }
        }
    });

    await t.test('every referenced screenshot exists on disk', () => {
        for (const cat of TUTORIAL_DATA)
            for (const les of cat.lessons)
                for (const st of les.steps) {
                    const p = path.join(IMG_DIR, st.img);
                    assert.ok(fs.existsSync(p), `missing screenshot: assets/tutorial/${st.img} (lesson ${les.id})`);
                }
    });
});

test('certificate letter-spacing helper', async (t) => {
    const HAIR = String.fromCharCode(8202);
    await t.test('tracks ASCII strings so the eyebrow/labels get spacing', () => {
        const out = _letterSpace('DATE', 2);
        assert.ok(out.includes(HAIR), 'ASCII string should have hair-spaces inserted');
        // No spacing character should sit before the first or after the last glyph.
        assert.equal(out.replace(new RegExp(HAIR, 'g'), ''), 'DATE');
    });
    await t.test('leaves Thai untouched so combining marks stay attached', () => {
        // Thai labels carry vowels/tone marks as separate code points; inserting a
        // hair-space between any two would detach a mark and garble the glyph.
        for (const s of ['วันที่', 'คะแนน', 'รหัสใบรับรอง']) {
            assert.equal(_letterSpace(s, 2), s, `Thai "${s}" must pass through unchanged`);
        }
    });
    await t.test('leaves Vietnamese diacritics untouched', () => {
        assert.equal(_letterSpace('Ngày', 2), 'Ngày');
    });
});

test('tutorial quiz', async (t) => {
    await t.test('pass mark is a sane percentage', () => {
        assert.ok(QUIZ_PASS_PCT > 0 && QUIZ_PASS_PCT <= 100);
    });
    await t.test('each question has 4 options and a valid answer index', () => {
        assert.ok(QUIZ_DATA.length >= 5, 'expected a real quiz');
        QUIZ_DATA.forEach((q, i) => {
            assertHasThai(q.q, `quiz[${i}] question`);
            assert.equal(q.o.length, 4, `quiz[${i}] must have 4 options`);
            q.o.forEach((o, j) => assertHasThai(o, `quiz[${i}] option ${j}`));
            assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < 4, `quiz[${i}] answer index out of range`);
        });
    });
});

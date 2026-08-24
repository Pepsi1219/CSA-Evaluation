import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TUTORIAL_DATA, QUIZ_DATA, QUIZ_PASS_PCT, _letterSpace, _stepImgSrc } from '../src/tutorial.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.join(__dirname, '..', 'public', 'assets', 'tutorial');

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

test('per-language screenshot resolution', async (t) => {
    await t.test('Thai (default) resolves to the flat fallback base', () => {
        assert.equal(_stepImgSrc('overview.png', 'th'), 'assets/tutorial/overview.png');
    });
    await t.test('other languages resolve to their own subfolder, same filename', () => {
        assert.equal(_stepImgSrc('overview.png', 'en'), 'assets/tutorial/en/overview.png');
        assert.equal(_stepImgSrc('overview.png', 'vn'), 'assets/tutorial/vn/overview.png');
        assert.equal(_stepImgSrc('overview.png', 'la'), 'assets/tutorial/la/overview.png');
    });
    await t.test('unknown/empty language falls back to the flat base', () => {
        assert.equal(_stepImgSrc('menu.png', ''), 'assets/tutorial/menu.png');
    });
    await t.test('the per-language folders exist so authors have a place to drop images', () => {
        for (const lang of ['en', 'vn', 'la']) {
            const dir = path.join(IMG_DIR, lang);
            assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
                `missing language folder assets/tutorial/${lang}/`);
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

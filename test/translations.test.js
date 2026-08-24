import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/translations.js';

// ---------------------------------------------------------------
// The runtime lookup used in script.js — mirrored here for testing.
// If script.js changes the fallback semantics, update this too.
// ---------------------------------------------------------------
function makeT(lang) {
    return key => translations[lang]?.[key] ?? translations.th[key] ?? key;
}

test('translations dictionary — top-level shape', async t => {
    await t.test('has all four supported languages', () => {
        assert.deepEqual(
            Object.keys(translations).sort(),
            ['en', 'la', 'th', 'vn'],
        );
    });
    await t.test('each language is a non-empty object', () => {
        for (const lang of Object.keys(translations)) {
            const dict = translations[lang];
            assert.equal(typeof dict, 'object');
            assert.ok(Object.keys(dict).length > 50, `${lang} is suspiciously small`);
        }
    });
});

test('key coverage across languages', async t => {
    const thKeys = new Set(Object.keys(translations.th));

    await t.test('en / vn / la cover every Thai key (no silent gaps)', () => {
        for (const lang of ['en', 'vn', 'la']) {
            const langKeys = new Set(Object.keys(translations[lang]));
            const missing = [...thKeys].filter(k => !langKeys.has(k));
            assert.equal(missing.length, 0,
                `${lang} is missing ${missing.length} key(s): ${missing.slice(0, 5).join(', ')}...`);
        }
    });

    await t.test('no accidental extras (each lang is a subset of th keys)', () => {
        // Anything present in a lang but not in th is likely a typo that would
        // silently miss the fallback chain — surface it.
        for (const lang of ['en', 'vn', 'la']) {
            const extras = Object.keys(translations[lang]).filter(k => !thKeys.has(k));
            assert.equal(extras.length, 0,
                `${lang} has ${extras.length} key(s) not in th: ${extras.join(', ')}`);
        }
    });

    await t.test('every value is a non-empty string', () => {
        for (const lang of Object.keys(translations)) {
            for (const [k, v] of Object.entries(translations[lang])) {
                assert.equal(typeof v, 'string', `${lang}.${k} is not a string`);
                assert.ok(v.length > 0, `${lang}.${k} is empty`);
            }
        }
    });
});

test('t() lookup + fallback chain', async t => {
    await t.test('known key returns the language string', () => {
        const t = makeT('en');
        assert.equal(t('sw_open'), 'Stopwatch');
    });
    await t.test('missing key in target lang falls back to Thai', () => {
        // Simulate a lang that's missing a key: create a shim
        const shim = { en_partial: { header1: 'Custom' } };
        const patched = Object.assign({}, translations, shim);
        const t = key => patched.en_partial?.[key] ?? patched.th[key] ?? key;
        assert.equal(t('header1'), 'Custom');
        assert.equal(t('sw_open'), 'จับเวลา');   // falls through to Thai
    });
    await t.test('unknown key returns the raw key', () => {
        const t = makeT('en');
        assert.equal(t('__does_not_exist__'), '__does_not_exist__');
    });
    await t.test('unknown lang falls all the way to key', () => {
        const t = key => translations['xx']?.[key] ?? translations.th[key] ?? key;
        assert.equal(t('sw_open'), 'จับเวลา');
        assert.equal(t('__missing__'), '__missing__');
    });
});

test('placeholder-substitution keys carry the tokens', () => {
    // Time Study result string uses {conf} / {N_raw} / {N} — losing one of
    // those tokens in translation breaks the rendered message.
    const requiredTokens = {
        ts_msg_prefix:    ['{conf}', '{N_raw}', '{N}'],
        ts_have_ok:       ['{n}'],
        ts_have_short:    ['{n}', '{more}'],
        ts_continue_btn:  ['{more}'],
    };
    for (const lang of Object.keys(translations)) {
        for (const [key, tokens] of Object.entries(requiredTokens)) {
            const value = translations[lang][key];
            for (const tok of tokens) {
                assert.ok(value.includes(tok),
                    `${lang}.${key} is missing token ${tok}: "${value}"`);
            }
        }
    }
});

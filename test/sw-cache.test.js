import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8');

test('transient server errors keep the working offline response', async () => {
    const handlers = new Map();
    const puts = [];
    const cached = new Response('working copy');
    let network = async () => new Response('server error', { status: 500 });
    const cache = { put: async (request, response) => puts.push([request, response]) };
    const context = {
        self: {
            __WB_MANIFEST: [],
            location: { origin: 'https://example.test' },
            addEventListener: (name, fn) => handlers.set(name, fn),
        },
        caches: {
            open: async () => cache,
            match: async () => cached,
        },
        fetch: request => network(request),
        Response, URL, setTimeout, clearTimeout,
    };
    runInNewContext(source, context, { filename: fileURLToPath(new URL('../src/sw.js', import.meta.url)) });
    const request = new Request('https://example.test/index.html');
    const handleFetch = () => {
        let response;
        handlers.get('fetch')({ request, respondWith: promise => { response = promise; } });
        return response;
    };

    assert.equal((await handleFetch()).status, 500);
    assert.equal(puts.length, 0);
    network = async () => { throw new Error('offline'); };
    assert.equal(await (await handleFetch()).text(), 'working copy');
    network = async () => new Response('fresh');
    assert.equal(await (await handleFetch()).text(), 'fresh');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(puts.length, 1);
});

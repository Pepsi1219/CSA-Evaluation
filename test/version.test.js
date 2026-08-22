const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { APP_VERSION } = require('../version.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// version.js is the single source of truth. There is no build step, so a few
// artifacts must physically carry the version string too (the service-worker
// cache name, package.json, the footer fallback). These tests fail `npm test`
// the moment any of them drift from APP_VERSION — which is exactly the bug
// (CSV showed v1.13.0 while the app was v1.14.0) this guards against.

test('APP_VERSION is a sensible semver string', () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('sw.js CACHE matches APP_VERSION', () => {
    // The SW runs in its own context and cannot import the page global, so its
    // literal is kept in sync here instead. A byte change in sw.js is also what
    // forces old clients to re-install, so this literal must move every release.
    const m = read('sw.js').match(/const CACHE\s*=\s*'csa-v([\d.]+)'/);
    assert.ok(m, 'could not find `const CACHE = \'csa-vX.Y.Z\'` in sw.js');
    assert.equal(m[1], APP_VERSION);
});

test('package.json version matches APP_VERSION', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.version, APP_VERSION);
});

test('index.html footer fallback matches APP_VERSION', () => {
    // Script overwrites #appVersion at runtime; the static fallback should still
    // match so a no-JS view (or a failed load) never shows a stale number.
    const m = read('index.html').match(/id="appVersion">v([\d.]+)</);
    assert.ok(m, 'could not find <span id="appVersion">vX.Y.Z< in index.html');
    assert.equal(m[1], APP_VERSION);
});

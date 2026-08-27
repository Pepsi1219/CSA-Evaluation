// Copyright (c) 2025 Pongsathon. All rights reserved. Proprietary — see LICENSE.
//
// Vite build config. Phase 3 adds JavaScript obfuscation to the shipped bundle
// as the deterrence layer that goes with the LICENSE. Firestore Security Rules
// are the actual data guard; obfuscation only makes the client-side calc logic
// costly to lift, not impossible.
//
// Tuning notes (change with caution):
//   - include only src/*.js — never obfuscate node_modules; Firebase in
//     particular has computed identifiers the transformer will happily break.
//   - controlFlowFlattening / stringArray with base64 encoding is the sweet
//     spot: heavy enough to make the calc pipeline unreadable, light enough
//     that bundle bloat stays manageable and mobile paint time isn't hurt.
//   - selfDefending guards the obfuscator's own output against being reformatted;
//     debugProtection makes DevTools trip a debugger loop on the calc path.
//   - disableConsoleOutput silences console.* — fine because we ship no logs.
//   - renameGlobals stays FALSE: turning it on would rename references like
//     `document`/`window`/DOM ids that our code assumes stay stable.
import { defineConfig } from 'vite';
import obfuscator from 'vite-plugin-javascript-obfuscator';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    // Dev server on a fresh port (not vite's default 5173) so any leftover
    // service worker from a prod visit — which is scoped to the origin it was
    // registered on — cannot intercept requests here. Origin is (host, port);
    // moving to :5199 gives dev a clean origin no SW is registered against.
    server: { port: 5199, strictPort: true },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,   // never ship source maps — they undo every layer below
    },
    // Pre-bundle Firebase's tree-shakeable ESM entrypoints so `npm run dev`
    // serves the SDK as a handful of chunks instead of dozens of individual
    // module requests. Without this, cold-starting dev on this project takes
    // several seconds to boot into the login card because each nested Firebase
    // module round-trips through the dev server. Prod isn't affected (Rollup
    // bundles regardless of this option).
    optimizeDeps: {
        include: [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
        ],
    },
    plugins: [
        // Service worker — injectManifest strategy so we keep the hand-tuned
        // network-first + timeout logic in src/sw.js and just let the plugin
        // inject the precache list (Vite's hashed asset filenames). main.js
        // still registers the SW manually, so injectRegister is disabled.
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            injectRegister: null,
            manifest: false,      // public/manifest.json is authored by hand
            injectManifest: {
                globPatterns: ['**/*.{html,js,css,svg,png,json}'],
                globIgnores: [
                    // Per-language tutorial screenshots are runtime-cached on
                    // first view (Thai fallback covers the rest); precaching
                    // them would balloon the install and hit addAll with 404s
                    // for the not-yet-shot languages.
                    '**/assets/tutorial/{en,vn,la}/**',
                ],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
            devOptions: { enabled: false },   // don't run SW in dev
        }),
        obfuscator({
            include: ['src/**/*.js'],
            exclude: [/node_modules/],
            apply: 'build',   // dev preserves readable source for HMR + debugging
            options: {
                // Light preset — the previous heavy config (controlFlowFlattening,
                // deadCodeInjection, base64 stringArray, transformObjectKeys) made
                // the shipped bundle noticeably sluggish on the first tap after a
                // cold start; every string lookup and every hot path paid a
                // constant tax. We keep only the cheap transforms:
                //   - identifier renaming (hexadecimal names) — deterrence with
                //     zero runtime cost after the JIT primes
                //   - stringArray without encoding — a modest string-hiding pass
                //     that doesn't decode on every read
                //   - disableConsoleOutput — silences prod logs
                // debugProtection / selfDefending remain off (they freeze users);
                // renameGlobals must remain off (breaks DOM id / document refs).
                compact: true,
                controlFlowFlattening: false,
                deadCodeInjection: false,
                debugProtection: false,
                disableConsoleOutput: true,
                identifierNamesGenerator: 'hexadecimal',
                renameGlobals: false,
                selfDefending: false,
                stringArray: true,
                stringArrayEncoding: ['none'],
                stringArrayThreshold: 0.5,
                transformObjectKeys: false,
                unicodeEscapeSequence: false,
            },
        }),
    ],
});

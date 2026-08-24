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
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,   // never ship source maps — they undo every layer below
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
                // Kept:
                //   controlFlowFlattening + deadCodeInjection + stringArray(base64)
                //   are the real deterrence and cost nothing at runtime.
                //   disableConsoleOutput silences prod logs.
                // Removed:
                //   debugProtection — its infinite `debugger;` loop froze the
                //     Vercel deploy so users couldn't click ANYTHING (an anti-
                //     debug measure that also breaks real users on mobile
                //     browsers). Never turn this back on for this app.
                //   selfDefending — kept off; it also interacts badly with
                //     minifiers/CDN transforms and offers little over the
                //     stringArray+flattening we already run.
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.75,
                deadCodeInjection: true,
                deadCodeInjectionThreshold: 0.4,
                debugProtection: false,
                disableConsoleOutput: true,
                identifierNamesGenerator: 'hexadecimal',
                renameGlobals: false,   // MUST stay false — see note at top
                selfDefending: false,
                stringArray: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.75,
                transformObjectKeys: true,
                unicodeEscapeSequence: false,
            },
        }),
    ],
});

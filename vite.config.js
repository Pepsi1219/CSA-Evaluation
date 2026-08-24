// Minimal Vite config for Phase 1 (ESM migration).
// - Root = repo root (index.html at repo root, sources will move to src/ in Phase 1b).
// - `public/` holds static assets copied verbatim to dist (manifest, icon, tutorial screenshots).
// - No obfuscator / PWA plugin yet — added in Phase 3 / Phase 4.
import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
    },
});

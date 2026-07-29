# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CSA Evaluation Calculator — a single-page, installable PWA (no build step, no framework, no package manager) for evaluating manufacturing line efficiency: target output vs. actual output, quality pass rate, and a training/learning-curve plan. UI text is in Thai by default with English, Vietnamese, and Lao translations.

The shipped app is five files at the repo root (no build step):
- `index.html` — all markup (main form + feedback modal + stopwatch modal + history/compare modal), loads `style.css`, then `calc.js`, then `script.js`
- `calc.js` — pure calculation functions only, no DOM access (see below)
- `script.js` — all application/DOM logic (~1000+ lines, no modules/imports)
- `style.css` — all styling (numbered sections via comment headers, e.g. `/* ---- 9. Inputs & Layout ---- */`)
- `sw.js` — service worker for offline caching
- `manifest.json` / `icon.svg` — PWA manifest and icon

`package.json` and `test/` exist only to run `calc.js`'s unit tests (see Development below) — they are not part of the deployed app.

## Development

There is no build, bundle, or lint tooling in this repo, and `package.json` exists only to run `calc.js`'s unit tests (see below) — not to build or serve the app. To work on the app, open `index.html` directly in a browser or serve the directory with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

**Bump the service worker cache version** in `sw.js` (`const CACHE = 'csa-vX.Y.Z'`) whenever deployed assets change — the fetch handler is network-first but the cache version string is what forces old clients to drop stale caches. Keep this in sync with the version shown in the footer (`index.html`, `.app-footer`).

`calc.js` holds the pure calculation functions (no DOM access), extracted from `script.js` specifically so they can be unit tested. Run `npm test` (Node's built-in `node:test` runner, no dependencies) to check them — see `test/calc.test.js`. `package.json` exists only for this; the shipped app still has no build step.

**Do not open a browser preview to visually verify UI/CSS changes in this project.** The user does that verification themselves and is better positioned to judge it. After editing code, confirm correctness through reading the code, `npm test`, and static checks — don't launch `preview_start` or drive the Browser pane for this repo unless the user explicitly asks for it.

## Architecture

**Single global calculation pipeline.** Nearly every input field has `oninput="calculateAll()"`. `calculateAll()` in `script.js` reads all form fields fresh each call, computes four sections in order, and writes results back into readonly fields — there is no separate state object for form data; the DOM *is* the state:
1. **Target**: `targetDisplay` from SAM value + efficiency target
2. **Actual**: cycle time and actual efficiency/output from recorded time + count
3. **Quality**: pass rate from pass/fail quantities
4. **Training plan**: generates day-by-day cards (`#trainingGrid`) and feeds `_chartCache`, which `renderChartFromCache()` / `renderSVGChart()` render as a hand-built inline SVG line chart (no charting library) showing the learning-curve gap between current and target efficiency.

**Stopwatch modal (`sw` object)** is a separate self-contained timer with its own state machine (`lap` vs `single` mode, running/elapsed/laps), independent of `calculateAll()`. `swSaveToForm()` is the only bridge — it writes computed time/count values into the main form's inputs and calls `calculateAll()`.

**i18n** is a flat `translations` object keyed by language code (`th`/`en`/`vn`/`la`) with string keys matching `data-key` attributes on elements (class `lang-text`). `changeLanguage()` walks the DOM and swaps text content (and `[data-key-placeholder]` attributes for input placeholders); `t(key)` is the lookup helper used inside JS-generated HTML (training cards, chart labels, compare table). When adding new UI copy, add the key to all four language blocks and reference it via `data-key="..."` (static markup) or `t('key')` (dynamically generated markup) — otherwise text falls back to Thai or the raw key.

**Persistence (`localStorage`), all in `script.js`:**
- Form auto-save: every `calculateAll()` call ends with `saveFormState()`, persisting the current input fields under `csa_form_v1`; `restoreFormState()` runs once at init, before the first `calculateAll()`.
- History: an explicit "Save current" action (`saveCurrentToHistory()`) snapshots the current inputs + computed results as one entry under `csa_history_v1` (capped at `HISTORY_MAX`, FIFO-trimmed) — this is a separate, deliberate action from the continuous auto-save above. The history modal lets the user select 2+ saved entries to render into a side-by-side compare table (`renderCompareTable()`).
- Theme preference (`csa_theme`) follows the same pattern — see the dark-mode note below.

**Dark mode**: all colors are CSS custom properties on `:root` (`style.css` §1). A parallel dark token set applies under `@media (prefers-color-scheme: dark)` by default, or via `:root[data-theme="dark"]`/`[data-theme="light"]` when the user explicitly toggles (`toggleTheme()`), which persists the choice to `localStorage`. The hand-built SVG chart in `renderSVGChart()` already draws with `var(--...)` tokens, so it re-themes automatically.

**External integrations, both feature-flagged in `script.js`:**
- Feedback modal submits to a Google Form via `fetch(... mode: 'no-cors')` — controlled by `GFORM_ENABLED` / `GFORM.url` / `GFORM.entry.*` (entry IDs are tied to the specific Google Form).
- Google Analytics 4 is lazy-injected via `initGA4()` — controlled by `GA4_ENABLED` / `GA4_MEASUREMENT_ID`. Events are fired through `gaTrack(eventName, params)`; feature-usage events (`use_quality_section`, `use_training_plan`) are tracked once per session via the `_tracked` flags to avoid re-firing on every keystroke.

**PWA/offline**: `sw.js` pre-caches the core asset list on install and uses a network-first fetch strategy (fresh network response cached and returned when online; falls back to cache when offline). `index.html` also sets no-cache HTTP meta tags so the HTML shell itself is never cached client-side — only the service worker's own cache controls offline behavior.

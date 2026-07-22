# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CSA Evaluation Calculator — a single-page, installable PWA (no build step, no framework, no package manager) for evaluating manufacturing line efficiency: target output vs. actual output, quality pass rate, and a training/learning-curve plan. UI text is in Thai by default with English, Vietnamese, and Lao translations.

The entire app is four files at the repo root:
- `index.html` — all markup (main form + feedback modal + stopwatch modal), loads `style.css` and `script.js`
- `script.js` — all application logic (~900 lines, no modules/imports)
- `style.css` — all styling (numbered sections via comment headers, e.g. `/* ---- 9. Inputs & Layout ---- */`)
- `sw.js` — service worker for offline caching
- `manifest.json` / `icon.svg` — PWA manifest and icon

## Development

There is no build, bundle, lint, or test tooling in this repo (no `package.json`). To work on the app, open `index.html` directly in a browser or serve the directory with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

**Bump the service worker cache version** in `sw.js` (`const CACHE = 'csa-vX.Y.Z'`) whenever deployed assets change — the fetch handler is network-first but the cache version string is what forces old clients to drop stale caches. Keep this in sync with the version shown in the footer (`index.html`, `.app-footer`).

## Architecture

**Single global calculation pipeline.** Nearly every input field has `oninput="calculateAll()"`. `calculateAll()` in `script.js` reads all form fields fresh each call, computes four sections in order, and writes results back into readonly fields — there is no separate state object for form data; the DOM *is* the state:
1. **Target**: `targetDisplay` from SAM value + efficiency target
2. **Actual**: cycle time and actual efficiency/output from recorded time + count
3. **Quality**: pass rate from pass/fail quantities
4. **Training plan**: generates day-by-day cards (`#trainingGrid`) and feeds `_chartCache`, which `renderChartFromCache()` / `renderSVGChart()` render as a hand-built inline SVG line chart (no charting library) showing the learning-curve gap between current and target efficiency.

**Stopwatch modal (`sw` object)** is a separate self-contained timer with its own state machine (`lap` vs `single` mode, running/elapsed/laps), independent of `calculateAll()`. `swSaveToForm()` is the only bridge — it writes computed time/count values into the main form's inputs and calls `calculateAll()`.

**i18n** is a flat `translations` object keyed by language code (`th`/`en`/`vn`/`la`) with string keys matching `data-key` attributes on elements (class `lang-text`). `changeLanguage()` walks the DOM and swaps text content; `t(key)` is the lookup helper used inside JS-generated HTML (training cards, chart labels). When adding new UI copy, add the key to all four language blocks and reference it via `data-key="..."` (static markup) or `t('key')` (dynamically generated markup) — otherwise text falls back to Thai or the raw key.

**External integrations, both feature-flagged in `script.js`:**
- Feedback modal submits to a Google Form via `fetch(... mode: 'no-cors')` — controlled by `GFORM_ENABLED` / `GFORM.url` / `GFORM.entry.*` (entry IDs are tied to the specific Google Form).
- Google Analytics 4 is lazy-injected via `initGA4()` — controlled by `GA4_ENABLED` / `GA4_MEASUREMENT_ID`. Events are fired through `gaTrack(eventName, params)`; feature-usage events (`use_quality_section`, `use_training_plan`) are tracked once per session via the `_tracked` flags to avoid re-firing on every keystroke.

**PWA/offline**: `sw.js` pre-caches the core asset list on install and uses a network-first fetch strategy (fresh network response cached and returned when online; falls back to cache when offline). `index.html` also sets no-cache HTTP meta tags so the HTML shell itself is never cached client-side — only the service worker's own cache controls offline behavior.

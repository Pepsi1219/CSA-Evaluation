# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CSA Evaluation Calculator (displayed as **"Industrial Engineering Calculator"** in the UI, but the repo, package, manifest, CSV/PDF filenames, and service-worker cache prefix still use `csa-*`) — a single-page, installable PWA (no build step, no framework, no package manager) for evaluating manufacturing line efficiency: target output vs. actual output, quality pass rate, and a training/learning-curve plan. UI text is in Thai by default with English, Vietnamese, and Lao translations.

The shipped app is a handful of files at the repo root (no build step). JS files are loaded as **plain globals via `<script defer>` in order** — no ES modules, no imports/exports at the browser layer; every module also has a bottom `if (module.exports)` guard so it can be `require()`-d from Node tests. Load order in `index.html` matters (later files reference earlier globals):

- `index.html` (~715 lines) — all markup: main form + feedback modal + formula modal + stopwatch modal + history/compare modal + Time Study config modal + onboarding overlay
- `style.css` (~2100 lines) — all styling (numbered sections via comment headers, e.g. `/* ---- 9. Inputs & Layout ---- */`)
- `calc.js` (~65 lines) — pure calc: `pcsFromEff`, `calcAvgMin`, `calcActualEff`, `newSamFromEff`, `calcActualPcsPerHr`, `calcPassRate`, `calcTrainingDay`. No DOM access.
- `timeutil.js` (~105 lines) — pure time + Time Study helpers: `fmtSw` / `fmtSec2` / `fmtSec4` (formatters), `snapLapMs` (10 ms display-resolution snap), `T_TABLE` + `tsTValue` (two-tailed Student's t critical values, df 1–30), `computeSampleSize(laps, confidence, errorPercent)` (sample-SD with Bessel's `n-1`, returns `{n, mean, sd, df, tVal, N_raw, N}`), CSV helpers `csvEscape` / `csvRow` / `csvBuild` (RFC 4180 with UTF-8 BOM for Excel Thai support). No DOM access.
- `translations.js` (~560 lines) — flat i18n dictionary keyed by `th`/`en`/`vn`/`la`; the `translations` object is a browser global consumed by `t()` + `changeLanguage()` in `script.js`.
- `chart.js` (~155 lines) — hand-built inline SVG learning-curve chart (no charting library). Owns `chartMode` ('pcs' | 'eff'), `_chartCache`, `_chartAnimated` (one-shot line-draw animation flag), `setChartMode`, `renderChartFromCache`, `renderSVGChart`. Draws with `var(--...)` tokens so it re-themes automatically. Depends on globals from `script.js` (`currentLang`, `pcsPerHr`).
- `history.js` (~250 lines) — saved evaluations + compare table. Owns `csa_history_v1` storage, `saveCurrentToHistory`, `deleteHistoryEntry`, `setHistoryNote`, the history modal DOM refs, and `renderHistoryList` / `renderCompareTable`. Depends on globals from `calc.js`, `translations.js`, and `script.js` (`t`, `currentLang`, `pcsPerHr`, `gaTrack`, `getSamMinutes`). **This is the seam** the future Firestore backend will swap through.
- `script.js` (~1570 lines) — the rest: stopwatch state machine + rAF ticker, `calculateAll` recompute pipeline, Time Study UI wiring, ambient-status setters, feedback modal + offline queue, `FORMULA_DEFS` + `openFormulaModal`/`closeFormulaModal` for the per-field "how it's calculated" popup, PWA install prompt, first-run onboarding, theme toggle, GA4, event wiring, init.
- `sw.js` — service worker: network-first with 3 s timeout, cache fallback for GET, cached-index.html fallback for navigations, synthetic 503 for anything else. Bump `CACHE = 'csa-vX.Y.Z'` on every deploy.
- `manifest.json` / `icon.svg` — PWA manifest and icon.

`package.json` and `test/` exist only to run the `node:test` unit tests — they are not part of the deployed app.

## Development

There is no build, bundle, or lint tooling in this repo, and `package.json` exists only to run `calc.js`'s unit tests (see below) — not to build or serve the app. To work on the app, open `index.html` directly in a browser or serve the directory with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

**Bump the service worker cache version** in `sw.js` (`const CACHE = 'csa-vX.Y.Z'`) whenever deployed assets change — the fetch handler is network-first but the cache version string is what forces old clients to drop stale caches. Keep this in sync with the version shown in the footer (`index.html`, `.app-footer`).

Run `npm test` (Node's built-in `node:test` runner, no dependencies) to check the pure modules — `calc.js`, `timeutil.js` (formatters + T-table + sample-size + CSV), and `translations.js` (dictionary integrity + fallback chain + placeholder-token preservation). Current coverage: 80+ tests across `test/calc.test.js`, `test/timeutil.test.js`, `test/translations.test.js`. `package.json` exists only for this; the shipped app still has no build step.

**Do not open a browser preview to visually verify UI/CSS changes in this project.** The user does that verification themselves and is better positioned to judge it. After editing code, confirm correctness through reading the code, `npm test`, and static checks — don't launch `preview_start` or drive the Browser pane for this repo unless the user explicitly asks for it.

**Never `git push` (or merge to `main`, or otherwise publish) unless the user explicitly tells you to in that turn.** This repo deploys to GitHub Pages (`pepsi1219.github.io`), so a push goes live immediately. Committing locally is fine when asked, but pushing/merging always requires an explicit, current instruction — a push from an earlier request does not authorize the next one.

## Architecture

**Single global calculation pipeline.** Nearly every input field has `oninput="calculateAll()"`. `calculateAll()` in `script.js` reads all form fields fresh each call, computes four sections in order, and writes results back into readonly fields — there is no separate state object for form data; the DOM *is* the state:
1. **Target**: `targetDisplay` from SAM value + efficiency target
2. **Actual**: cycle time and actual efficiency/output from recorded time + count
3. **Quality**: pass rate from pass/fail quantities
4. **Training plan**: generates day-by-day cards (`#trainingGrid`) and feeds `_chartCache`, which `renderChartFromCache()` / `renderSVGChart()` render as a hand-built inline SVG line chart (no charting library) showing the learning-curve gap between current and target efficiency.

**Stopwatch modal (`sw` object)** is a separate self-contained timer with its own state machine (`lap` vs `single` mode, running/paused/finalized, `sw.laps`), independent of `calculateAll()`. Uses `performance.now()` monotonic time + `requestAnimationFrame` at ~30 fps for battery + NTP-jump safety. On each `Lap` (or the final `Stop` in lap mode), the elapsed slice is snapped to 10 ms via `snapLapMs()` **on capture** so stored lap value == displayed value — hand-calculating SD from what's on screen returns the same number as the app. Closing the modal mid-run **preserves the in-progress lap** (sets `sw.paused=true`) so users don't silently lose data. The Time Study "required N" row + Continue button below the summary calls `computeSampleSize` from `timeutil.js`. `swSaveToForm()` is the only bridge to the main form.

**iOS keyboard handling.** `visualViewport` resize listener translates the sticky save panel above the on-screen keyboard so the Save button never hides beneath it.

**Ambient status.** `#actualEffPerc`, `#actualPcs`, and `#passRate` get `data-status="ok|warn|bad"` set by `setStatus()` from `calculateAll()`, driven by thresholds in `statusForEfficiency()` / `statusForPassRate()`. CSS in `style.css` translates the attribute into background + text color (using the `--status-*` tokens) so line supervisors can scan a shift at a glance.

**Formula modal.** Every computed field's `<label>` is a `.fx-label` with `data-fx="<key>"` and a small ⓘ icon. A document-level click-delegation handler in `script.js` opens `#formulaModal`, which reads the matching entry in `FORMULA_DEFS` (keyed by `target_pcs` / `new_sam` / `avg_sec` / `avg_min` / `actual_eff` / `actual_pcs` / `pass_rate`) and shows three blocks: **สูตร** (translated formula string), **คำอธิบาย** (translated description), and **ค่าที่คุณป้อน** (each def's `compute()` reads current form inputs and returns a substituted expression + result; returns `null` when inputs are missing → the modal shows `fx_no_data` instead). When adding a new computed field, add its `<label class="fx-label" data-fx="...">` in `index.html`, an entry in `FORMULA_DEFS`, and the `fx_formula_<key>` + `fx_desc_<key>` translation pair to all four language blocks (the translations test enforces parity).

**i18n** is a flat `translations` object (in `translations.js`) keyed by language code (`th`/`en`/`vn`/`la`) with string keys matching `data-key` attributes on elements (class `lang-text`). `changeLanguage()` walks the DOM and swaps text content (and `[data-key-placeholder]` attributes for input placeholders); `t(key)` is the lookup helper used inside JS-generated HTML (training cards, chart labels, compare table, N-row breakdown). When adding new UI copy, add the key to all four language blocks and reference it via `data-key="..."` (static markup) or `t('key')` (dynamically generated markup) — otherwise text falls back to Thai or the raw key. `test/translations.test.js` enforces this: it fails the build if `en`/`vn`/`la` are missing any key present in `th`, if any value is empty, or if a translation lost a `{placeholder}` token. Chosen language persists to `localStorage` under `csa_lang`.

**Persistence (`localStorage`):**
- Form auto-save (`csa_form_v1`) in `script.js` — every `calculateAll()` call ends with `saveFormState()`; `restoreFormState()` runs once at init.
- History (`csa_history_v1`) in `history.js` — explicit "Save current" via `saveCurrentToHistory()` snapshots inputs + computed results + optional shift-handover note (`entry.note`, max 200 chars, editable per row). Capped at `HISTORY_MAX` (100), FIFO-trimmed. Compare view lets the user pick 2+ entries → side-by-side table.
- Theme (`csa_theme`), language (`csa_lang`), session count (`csa_session_count`, used by the PWA install-prompt gate), onboarding-seen (`csa_onboarded_v1`), and feedback offline queue (`csa_feedback_queue_v1`, cap 20 entries) — each follows the same read-on-init / write-on-change pattern.

**Design tokens** (`style.css` §1): all colors are CSS custom properties on `:root`. A parallel dark token set applies under `@media (prefers-color-scheme: dark)` by default, or via `:root[data-theme="dark"]`/`[data-theme="light"]` when the user explicitly toggles (`toggleTheme()`, persisted to `csa_theme`). The hand-built SVG chart in `renderSVGChart()` draws with `var(--...)` tokens, so it re-themes automatically. Three semantic families to keep straight when adding UI:
- `--accent-*` (indigo) — brand, target / plan surfaces, primary actions. `--accent-grad` is **reserved for the primary CTA + brand mark only** (using it everywhere is what makes the app read as AI-scaffolded).
- `--accent-teal-*` — "actual / measured" surfaces (differentiates shop-floor readouts from the plan). Applied via `.actual-section` scope.
- `--status-{ok,warn,bad}-*` — threshold-driven ambient tint on result values. Semantic, never used as brand.

**External integrations, both feature-flagged in `script.js`:**
- Feedback modal submits to a Google Form via `fetch(... mode: 'no-cors')` — controlled by `GFORM_ENABLED` / `GFORM.url` / `GFORM.entry.*`. `no-cors` means the fetch always resolves opaquely (server errors are invisible); the mitigation is: if `!navigator.onLine`, submissions get queued in `csa_feedback_queue_v1` and drained on `online` event (and once at startup). The real fix for reliable ACKs is a Cloudflare Worker / Supabase Edge proxy — not yet built.
- Google Analytics 4 is lazy-injected via `initGA4()` — controlled by `GA4_ENABLED` / `GA4_MEASUREMENT_ID`. Events are fired through `gaTrack(eventName, params)`; feature-usage events (`use_quality_section`, `use_training_plan`) are tracked once per session via the `_tracked` flags to avoid re-firing on every keystroke.

**PWA install + onboarding:**
- `beforeinstallprompt` is stashed on `window`; the header install chip (`#installBtn`) reveals only after the 2nd session (`csa_session_count`) and only when not already in standalone mode. Silent on iOS Safari (event never fires).
- First-run 3-screen onboarding tour (`#onboardingOverlay`) shows once, persisted via `csa_onboarded_v1`. Skip button always available. `showOnboardingIfNeeded()` runs from init.

**PWA/offline**: `sw.js` pre-caches the core asset list on install (bump `ASSETS` when adding new JS/CSS/JSON) and uses a **network-first with 3 s timeout** fetch strategy. Fallback cascade: cached response → cached `index.html` (for navigation requests) → synthetic 503. Never resolves to `undefined` (which would throw inside `respondWith` and show the browser's native offline page). `index.html` also sets no-cache HTTP meta tags so the HTML shell itself is never cached client-side — only the service worker's own cache controls offline behavior.

**Export:**
- **CSV** (`exportCSV()` in `script.js`) — bilingual key/value rows via `csvBuild` / `csvRow` / `csvEscape` in `timeutil.js`. UTF-8 BOM prepended so Excel opens Thai correctly.
- **PDF** — browser's native "Save as PDF" via `printReport()` → `window.print()`. Print stylesheet (`@page A4 portrait`, forced color, single-column, safe-area-friendly, self-referential URLs) is authored to make the PDF audit-ready without shipping jsPDF or fighting Thai font embedding.

# Tutorial screenshots — per-language guide

The in-app learning centre (`tutorial.js`) shows one screenshot per lesson step.
Screenshots are now **language-specific**: when the user picks a language, the
tutorial shows that language's captures.

## Folder layout

```
assets/tutorial/
├── overview.png          ← Thai (default) — the fallback base, DO NOT rename/move
├── menu.png
├── … (11 files)          ← the existing Thai captures
├── en/                   ← English captures  (same filenames)
├── vn/                   ← Vietnamese captures (same filenames)
└── la/                   ← Lao captures       (same filenames)
```

**Rule:** the base filename is identical in every language — only the folder
changes. Lesson "Screen overview" is always `overview.png`; its English capture
is `en/overview.png`, Vietnamese `vn/overview.png`, Lao `la/overview.png`.

- **Thai** lives flat in `assets/tutorial/` and is already done — leave it as is.
- **en / vn / la** go in their subfolder, each using the **exact same 11
  filenames** listed below.

## How resolution works (no code changes needed to add images)

`_stepImgSrc()` in `tutorial.js` builds the path for the active language:

- `th` → `assets/tutorial/<file>`
- `en` / `vn` / `la` → `assets/tutorial/<lang>/<file>`

If a language file is missing, the `<img>` `onerror` handler automatically falls
back to the Thai capture, so the tutorial never shows a broken image. **Just drop
a correctly-named PNG into the language folder and it appears** — nothing else to
wire up. (The service worker runtime-caches each image on first view, so they
work offline too.)

## The 11 filenames and which lesson each belongs to

| Filename            | Category → Lesson                                              |
|---------------------|---------------------------------------------------------------|
| `overview.png`      | Getting started → Screen overview (step 1: 4-section home)     |
| `menu.png`          | Getting started → Screen overview (step 2: the ⋮ menu); reused by Save & export → Export CSV & PDF |
| `numpad.png`        | Getting started → Entering numbers with the in-app keypad      |
| `sam-target.png`    | Setting the target → SAM and target efficiency (steps 1 & 2)   |
| `formula-modal.png` | Setting the target → See how it is calculated (the ⓘ button)   |
| `stopwatch.png`     | Measuring the actual → Timing with the stopwatch (steps 1 & 2) |
| `time-study.png`    | Measuring the actual → Time Study, required rounds (steps 1 & 2) |
| `actual-status.png` | Measuring the actual → Reading actual efficiency & status colour |
| `quality.png`       | Quality → Pass rate                                           |
| `training-chart.png`| Training plan → Build the plan & read the chart (steps 1 & 2)  |
| `history.png`       | Save & export → History & compare                            |

To capture a language: switch the app to that language, drive it into each state,
screenshot, save under the matching filename in that language's folder. Keep the
Thai captures' framing/aspect ratio so the layout stays consistent.

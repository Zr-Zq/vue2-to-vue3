# HTML stream / JS stream and handoff file

## Principles

- **HTML stream**: only change `<template>` / `<style>` (e.g. `.sync`, slots, `|filter`tocall, `:deep()`).
- **JS stream**: only change `<script>` / options objects (e.g. `filterstomethods`, `render(h)`, lifecycle).
- When there is a cross-stream dependency, **do not hard-couple**: HTML writes handoff, JS consumes; if JS cannot find the target, **skip**.

## Handoff file

Path: `<project>/.v23/handoff.json`

After HTML rewrites `|upper` to `upper()`, it registers:

```json
{
  "kind": "filters-to-methods",
  "fromStream": "html",
  "toStream": "js",
  "toPlugin": "migrate-filters",
  "file": "src/fixtures/pure-vue2/edge-coverage.vue",
  "filters": ["upper"],
  "status": "pending"
}
```

JS stream `migrate-filters`:

| Case | status |
|------|--------|
| Found `filters` and merged into `methods` | `done` |
| Same name as an existing method — keep method, store filter as `__v23Filter_<name>`, rewrite mustache / `v-bind` calls | `done` |
| No `filters` (already migrated / absent) | `skipped` (not a failure) |

## Pipeline presets

In `v23.pipeline.js`, `preflightPipeline` may be:

| Value | Meaning |
|-------|---------|
| `'html-only'` | HTML stream only + light risk summary |
| `'js-only'` | JS stream only (reads handoff) |
| `'full'` / array | Full HTMLtoJStorisks |
| custom array | e.g. risks-only (HTML quirks + JS risks + `risk-options-composition` + annotate), used by `2.pure-vue-app` before OptionstoComposition rewrite |

Example:

```js
module.exports = {
  // Does not rewrite sources. In-place writes require: v23-run <project> --write
  dryRun: true,
  preflightPipeline: 'html-only', // preview templates
}
// later:
// preflightPipeline: 'js-only'
```

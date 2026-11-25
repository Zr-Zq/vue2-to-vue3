# HTML (template) Processing: Format and Role (for AI)

## Role

After a Vue SFC is split into **HTML + JS**, this module only handles **HTML inside `<template>`**:

- Scan tags / attributes / `{{ }}` interpolations (with line numbers)
- Emit Vue2toVue3-related findings
- **Does not change business logic**; risk plugins write `AI-TODO` from these (HTML comments)

Script entry: `2to3/src/analyze-html.js`  
Split entry: `2to3/src/sfc-parts.js` (`template` to `kind: 'html'`)

---

## API

```js
const { analyzeVueHtml, analyzeHtmlTemplate, scanHtml } = require('./src/analyze-html')

// Whole .vue file
const r = analyzeVueHtml(vueSource, absPath, fileRel)

// Template string only
const r2 = analyzeHtmlTemplate(templateCode, { file, range, templateAttrs })
```

### Return shape

| Field | Meaning |
|-------|---------|
| `kind` | Always `'html'` |
| `elements[]` | Open/close tags; includes `tag` / `attrs` / `attrsMap` / `loc` |
| `interpolations[]` | `{{ }}`; includes `filters[]` |
| `findings[]` | Migration risks (see below) |
| `summary` | Tag/directive counts, finding summary |

With `range.startLine` (template offset inside the SFC), `loc` is the **absolute file line**; the original relative line is in `templateLoc`.

---

## findings fields

| Field | Meaning |
|-------|---------|
| `id` | e.g. `html.v-for-v-if` |
| `category` | Same as risks: `filters` / `legacy-slot` / … |
| `level` | `info` / `warn` / `block` |
| `auto` | `yes` / `partial` / `no` |
| `part` | Always `'html'` |
| `file` | Project-relative path |
| `message` / `evidence` / `hint` | Description |
| `loc` | `{ line, column }` |

### Covered categories

- `v-for-v-if` — same-node `v-for` + `v-if`
- `filters` — `|` in interpolations / bindings
- `native-modifier` — `.native`
- `sync-modifier` — `.sync`
- `dynamic-args` — `:[x]` / `@[x]`
- `legacy-slot` — `slot` / `slot-scope` / mixed with `v-slot`
- `keepalive-combo` — `<keep-alive>` / `:is` (combo logic in `risk-keepalive-combo`)
- `functional` — `<template functional>`

---

## Pipeline outputs

After `v23-run` / preflight risks:

| File | Role |
|------|------|
| `.v23/risks.json` | Full risks (including `part: "html"`) |
| `.v23/html-risks.json` | HTML risks only + per-file summary |
| `graph.json` to `files[].html` | HTML summary attached at analyze time |

AI handling: open by `file:line`, edit the template; comments look like `<!-- migrate-script note: AI-TODO … -->` (Chinese legacy: `<!-- 迁移脚本注释: AI-TODO … -->`).

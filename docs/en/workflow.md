# 2to3 Migration Workflow (Scripts + AI)

## Inputs

| Flag | Meaning | Example |
|------|---------|---------|
| `--from` | Source project root to migrate | `D:/old-app` |
| `--src` | Source directory (relative to from) | `src` |
| `--to` | Target root (scaffold / base app) | `D:/new-app` |
| `--dest-src` | Target directory (default = src) | `src` |

## Stage order

```
1. analyze     Script: analyze the source project (graph / risk clues)
2. scaffold    **AI**: create the **Vue3** base (**Vite**; full config + deps installed + **can start** + **seamless script handoff**; see ./ai-scaffold-notes.md)
               · Do not use script `--scaffold` as the real base; **scripts never rewrite `.env*` / VUE_APP↔VITE**
3. copy        Script: from/src to to/src; also copy root sidecars (script/test/style/mock…)
               · If a same-named file already exists at the target to back up to to/.v23/backup/<timestamp>/ then overwrite
               · Rewrite imports to match the base alias (env/project config already prepared by AI)
4. pipeline    Script: deterministic syntax transforms (sync/native/slot/render/mount/Element UI→Plus/…)
               · Element: size/type=text/underline/date-format/dialog v-model/imports; icons & Vue.use still AI-TODO
               · Unsafe items get AI-TODO; **no env / project-config migration**
5. 【pause】   AI: fix ai-todos.md; if base renamed dirs (util→utils, axios path…), fill path-remap.md + path-remap.json
               then `--step path-remap` (ingested files only — see ./path-remap.md)
6. check       Script: v23-check-refs (missing local refs) + v23-check-syntax (JSON / JS / Vue script)
7. next round  After pass, optionally re-run pipeline / path-remap / build for acceptance
```

## Commands

```bash
# AI builds the Vue3 base first (full config + deps installed + can start), then run the script
node 2to3/bin/migrate.js --from D:/old-app --src src --to D:/new-app

# Analyze the source only
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --step analyze

# After AI fills .v23/path-remap.json (layout diffs)
node 2to3/bin/migrate.js --to D:/new-app --step path-remap

# After AI finishes AI-TODO items
node 2to3/bin/migrate.js --to D:/new-app --step check

# Run another script migration round
node 2to3/bin/migrate.js --to D:/new-app --step pipeline
```

## Repo fixtures (sources)

| Path | Role |
|------|------|
| `2.pure-vue-app` | Options → Composition + vue-router fixtures (`--from`) |
| `1.pure-vue-app` | Legacy template only; not the real Vue3 base |
| `my-vue-app` | Mixed Vue2 fixtures (do not delete files) |
| `element-ui-docs` | Full clone of ElemeFE/element **docs/examples** site (browse every official demo). Local notes: `element-ui-docs/README.local.md` (Node **16**, dart-sass patch). Not a typical migratable app layout — use for UI coverage testing, not as `--to`. |
| `element-ui-demo` | Optional Vue2 + element-ui app with `@`/`src` + migration probes (if present) for `--from`. **`--to` must still be AI Vite + Vue3 + Element Plus**. |

Example (when `element-ui-demo` exists):

```bash
node 2to3/bin/migrate.js --from element-ui-demo --src src --to output/element-ui-demo-migrate
```

## Division of labor

| Who | What |
|-----|------|
| Scripts | Analyze, copy+backup, deterministic syntax migration, mark AI-TODO, missing-ref checks, syntax checks; **never touch `.env*` / project config**. Analyze may write `<from>/.v23` reports only — **source files are not rewritten** unless `v23-run` / `v23-pipeline` is given `--write` (migration writes the `--to` tree) |
| AI | Build the **Vue3** base (Vite; **all project config**, **install deps**, **`npm run dev` works**, **seamless with scripts**), resolve AI-TODO, confirm missing refs, business-semantics decisions |

## Key artifacts (all under `<to>/.v23/`)

| File | Role |
|------|------|
| `migrate-state.json` | Current step state |
| `migrate-copy.json` | This copy’s inventory and backups |
| `backup/<timestamp>/` | Pre-overwrite file snapshots |
| `ai-todos.md` | AI todo list |
| `risks.json` / `html-risks.json` | Risk details |
| `missing-refs-for-ai.md` | Missing-ref confirmation list |
| `syntax-issues.json` / `syntax-issues-for-ai.md` | JSON and script syntax issues |
| `path-remap.md` / `path-remap.json` | AI layout diffs; applied by `--step path-remap` on `ingest-files.txt` only |
| `ingest-files.txt` | Files written by this copy (check-refs / path-remap scope) |

## Required reading for AI

AI agents use **this English set only** (`docs/en/`). Do not use `docs/zh` or `docs/ja` as the working entry.

- `./ai-scaffold-notes.md` — **Base init notes (prefer Vite, style false positives, etc.)**
- `./html-format.md` — HTML/template findings
- `./streams-handoff.md` — HTML/JS stream split and `.v23/handoff.json`
- `./missing-refs-format.md` — Missing-ref JSON
- `./syntax-check-format.md` — JSON / binding / script syntax check
- `./cannot-fully-auto.md` — Items that cannot be fully automated
- `./path-remap.md` — AI path layout diffs + scoped import rewrite

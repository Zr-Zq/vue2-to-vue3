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
4. pipeline    Script: deterministic syntax transforms (sync/native/slot/render/mount/…)
               · Unsafe items get AI-TODO; **no env / project-config migration**
5. 【pause】   AI: fix items listed in to/.v23/ai-todos.md one by one
6. check       Script: v23-check-refs (missing local refs) + v23-check-syntax (JSON / JS / Vue script)
7. next round  After pass, optionally re-run pipeline / build for acceptance
```

## Commands

```bash
# AI builds the Vue3 base first (full config + deps installed + can start), then run the script
node 2to3/bin/migrate.js --from D:/old-app --src src --to D:/new-app

# Analyze the source only
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --step analyze

# After AI finishes AI-TODO items
node 2to3/bin/migrate.js --to D:/new-app --step check

# Run another script migration round
node 2to3/bin/migrate.js --to D:/new-app --step pipeline
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

## Required reading for AI

AI agents use **this English set only** (`docs/en/`). Do not use `docs/zh` or `docs/ja` as the working entry.

- `./ai-scaffold-notes.md` — **Base init notes (prefer Vite, style false positives, etc.)**
- `./html-format.md` — HTML/template findings
- `./streams-handoff.md` — HTML/JS stream split and `.v23/handoff.json`
- `./missing-refs-format.md` — Missing-ref JSON
- `./syntax-check-format.md` — JSON / binding / script syntax check
- `./cannot-fully-auto.md` — Items that cannot be fully automated

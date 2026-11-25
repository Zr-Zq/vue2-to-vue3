# Syntax Check: File Format and Role (for AI)

## Role

After migration features are done, run this together with the missing-ref check. It reports code that will not parse:

- JSON objects (strict). `tsconfig.json` / `jsconfig.json` may contain comments and trailing commas
- Duplicate keys in strict JSON
- JS / TS / Vue `<script>` and `<script setup>` parse errors
- Declaration and identifier errors (`const` / `let` without an initializer, duplicate lexical bindings, reserved words) are `kind: "binding"`

Template HTML is not parsed as JavaScript. `.d.ts` files are skipped.

- **Script**: `2to3/scripts/check-syntax.js`
- **Wrapper**: `2to3/bin/check-syntax.js` (`v23-check-syntax`)
- **When it fails**: fix the migrated project or the migrator. Do not edit the source fixture to hide the error.

## How to run

```bash
node 2to3/bin/check-syntax.js <base-root>
node 2to3/bin/check-syntax.js <base-root> --all
node 2to3/bin/check-syntax.js <base-root> --files-from <list.txt>
node 2to3/scripts/check-syntax.js --self-test
```

`v23-migrate --step check` runs this after `v23-check-refs`. Each check still writes its report if the other fails.

| Exit code | Meaning |
|-----------|---------|
| 0 | No issues |
| 1 | One or more issues |

Scope: `src/**`, root `*.json`, and sidecar dirs (`script/`, `test/`, …). Skips `node_modules`, `dist`, `.v23`.

## Output files (under `<base>/.v23/`)

| File | Role |
|------|------|
| `syntax-issues.json` | Machine-readable result |
| `syntax-issues-for-ai.md` | Path:line list for AI |

## `syntax-issues.json`

Pass:

```json
{
  "ok": true,
  "projectRoot": "D:/.../app",
  "total": 0,
  "issues": []
}
```

Failure item:

| Field | Meaning |
|-------|---------|
| `file` | Path relative to the project root |
| `line` / `column` | 1-based location |
| `kind` | `json`, `json-duplicate-key`, `binding`, `syntax`, `vue-sfc` |
| `message` | Parser or JSON message |

## What AI does

1. Open `syntax-issues-for-ai.md`.
2. Fix the migrated file (broken JSON, illegal declaration, truncated script).
3. If the migrator emitted the broken syntax, fix `2to3` and re-run the pipeline. Leave `1.pure-vue-app`, `2.pure-vue-app`, and `my-vue-app` unchanged.
4. Re-run `v23-check-syntax` until `ok: true`.

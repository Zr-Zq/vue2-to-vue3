# Path remap (AI layout diffs)

When the Vue3 base **renames or moves** directories that ingested source files still import
(e.g. `util` → `utils`, `@/axios` → `@/api/axios`), scripts cannot invent the mapping.
**AI** writes a temporary comparison, then a **scoped** script rewrites imports only in
files from this migrate/copy batch.

## Artifacts (`<to>/.v23/`)

| File | Who | Role |
|------|-----|------|
| `path-remap.md` | AI | Human-readable source ↔ base comparison table (temporary) |
| `path-remap.json` | AI | Machine mappings for the script |
| `ingest-files.txt` | Script (copy) | Scope list — **only these files** are rewritten |
| `path-remap-report.json` | Script | What changed after apply |

Copy creates empty stubs for `path-remap.md` / `path-remap.json` if missing (does not overwrite).

## `path-remap.json` shape

```json
{
  "version": 1,
  "generatedBy": "ai",
  "notes": "Scaffold renamed util→utils; axios under api/",
  "mappings": [
    { "from": "@/util/", "to": "@/utils/" },
    { "from": "@/util", "to": "@/utils" },
    { "from": "@/axios", "to": "@/api/axios", "kind": "exact" }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `from` / `to` | Specifier prefix or exact string as written in `import` / `require` / `import()` |
| `kind` | omit or `"prefix"` (default): match exact **or** `from/` + rest. `"exact"`: only full specifier equality |

Longest `from` wins. Prefer both `@/util/` and `@/util` when renaming a directory.

## Commands

```bash
# After AI fills mappings:
node 2to3/bin/migrate.js --to <baseRoot> --step path-remap

# Or:
node 2to3/bin/apply-path-remap.js <baseRoot>
node 2to3/bin/apply-path-remap.js <baseRoot> --dry-run
node 2to3/bin/apply-path-remap.js <baseRoot> --stub
```

## Scope rules (hard)

- **Only** paths listed in `ingest-files.txt` (or `--files-from`).
- Does **not** walk the whole tree — AI-built base files stay untouched.
- Without a non-empty ingest list, the script **refuses** to run.
- Empty `mappings` → no-op success.

## AI checklist

1. Diff source layout vs base (`util` vs `utils`, where axios/request lives, alias roots).
2. Fill `path-remap.md` table + the same rows in `path-remap.json`.
3. Run `--step path-remap`.
4. Then `--step check` (refs/syntax). Re-fill mappings if missing refs still show old prefixes.

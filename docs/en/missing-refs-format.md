# Missing Reference Check: File Format and Role (for AI)

## Role

After **all migration features are done**, run this cleanup: check whether local `import` / `require` / `import()` / `export from` paths in the base project point at real files.

- **Script location (this repo; do not use a user global skill)**: `2to3/scripts/check-import-refs.mjs`
- **Wrapper entry**: `2to3/bin/check-refs.js` (`v23-check-refs`)
- **When missing**: hand results to AI to confirm “add file / fix ref / ignore false positive”

Alias resolution comes from `jsconfig` / `tsconfig` / `webpack.config.*` / `vite.config.*` found upward from the project under check (`@`, `~`, etc.).

---

## How to run

```bash
node 2to3/bin/check-refs.js <base-root>
node 2to3/bin/check-refs.js <base-root> --all
node 2to3/bin/check-refs.js <base-root> --files-from <list.txt>
```

Underlying equivalent:

```bash
node 2to3/scripts/check-import-refs.mjs <base-root> --json [--files-from list.txt]
```

| Exit code | Meaning |
|-----------|---------|
| 0 | Pass (no missing) |
| 1 | Missing or failed |
| 2 | Wrapper config error (detector not found, etc.) |

---

## Output files (all under `<base>/.v23/`)

| File | Role |
|------|------|
| `missing-refs.json` | Normalized full result; programs/AI should prefer this |
| `missing-refs-for-ai.md` | Human/AI-readable path:line list |
| `missing-refs.raw.txt` | Raw stdout/stderr from the underlying script |
| `ingest-files.txt` | Files written by ingest for “this ingest batch” (default check scope) |
| `all-src-files.txt` | Full src list generated with `--all` |

---

## `missing-refs.json` format

### On pass

```json
{
  "ok": true,
  "projectRoot": "D:/.../migrate-base",
  "totalMissing": 0,
  "missing": [],
  "checkedAt": "ISO-8601",
  "checker": ".../2to3/scripts/check-import-refs.mjs"
}
```

### On failure

```json
{
  "ok": false,
  "projectRoot": "D:/.../migrate-base",
  "totalMissing": 2,
  "missing": [
    {
      "file": "src/views/Foo.vue",
      "line": 12,
      "specifier": "@/components/Bar.vue",
      "missing": "src/components/Bar.vue",
      "project": ".",
      "raw": { }
    }
  ],
  "raw": { },
  "hint": "请 AI 逐条确认：补文件 / 改 import / 或忽略误报",
  "formatDoc": "2to3/docs/missing-refs-format.md",
  "checker": ".../check-import-refs.mjs",
  "checkerExit": 1
}
```

### `missing[]` fields (English keys after wrapping)

| Field | Type | Meaning |
|-------|------|---------|
| `file` | string | **Referencing** file (relative to project root); AI opens this |
| `line` | number\|null | Problematic line |
| `specifier` | string | Import string in source, e.g. `@/utils/x`, `./Child.vue` |
| `missing` | string | Resolved path expected to exist but missing on disk |
| `project` | string\|null | Subproject id used while resolving (useful in monorepos) |
| `raw` | object | Underlying raw entry (may include Chinese keys) |

### Underlying script raw failure JSON (`raw` / `missing-refs.raw.txt`)

When the underlying tool runs with `--json` and fails, stdout looks like:

```json
{
  "ok": false,
  "missing": [
    {
      "引用文件": "src/views/Foo.vue",
      "行号": 12,
      "导入语句": "@/components/Bar.vue",
      "缺失路径": "src/components/Bar.vue",
      "项目": "."
    }
  ],
  "aliases": { "@": "src", "~": "src" },
  "projectAliases": { },
  "checkedFiles": ["src/views/Foo.vue"]
}
```

Chinese key to English key mapping:

| Chinese key | English key |
|-------------|-------------|
| 引用文件 | file |
| 行号 | line |
| 导入语句 | specifier |
| 缺失路径 | missing |
| 项目 | project |

On success with `--json`, the underlying tool also includes `ok`, `aliases`, `checkedFiles`, etc.

---

## `missing-refs-for-ai.md` format

```markdown
# 缺失引用（请 AI 确认）

- 项目: `...`
- 共 N 条

1. `src/views/Foo.vue:12`
   - 导入: `@/components/Bar.vue`
   - 缺失路径: `src/components/Bar.vue`
```

AI handling convention:

1. Open the file by `` `file:line` ``.
2. Check whether `导入` (specifier) is wrong, or the target was never ingested.
3. Add the file / fix the path / mark as ignorable, then re-run `v23-check-refs` until `ok: true`.

---

## Capability boundaries

- **Covered**: local relative paths, project aliases; omitted extensions and `index`.
- **Skipped**: npm package names, URLs, `node:`, etc.
- **Not guaranteed**: purely dynamic string-built paths, module names only known at runtime.

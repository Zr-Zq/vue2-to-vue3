# 路径重映射（AI 布局差异）

当 Vue3 底座**改名或移动**了目录，而 copy 进来的源文件仍按旧路径 import
（例如 `util` → `utils`，`@/axios` → `@/api/axios`）时，脚本无法猜映射。
**由 AI** 写一份临时对照，再用**限定范围**的脚本，只改本轮迁入文件的 import。

## 产物（`<to>/.v23/`）

| 文件 | 谁写 | 作用 |
|------|------|------|
| `path-remap.md` | AI | 源 ↔ 底座对照表（临时） |
| `path-remap.json` | AI | 给脚本用的映射 |
| `ingest-files.txt` | 脚本 copy | **范围清单** — 只改这些文件 |
| `path-remap-report.json` | 脚本 | 应用结果 |

copy 时若无 stub 会生成空的 `path-remap.md` / `path-remap.json`（已有则不覆盖）。

## `path-remap.json` 格式

```json
{
  "version": 1,
  "generatedBy": "ai",
  "notes": "底座把 util 改成 utils；axios 放到 api/",
  "mappings": [
    { "from": "@/util/", "to": "@/utils/" },
    { "from": "@/util", "to": "@/utils" },
    { "from": "@/axios", "to": "@/api/axios", "kind": "exact" }
  ]
}
```

| 字段 | 含义 |
|------|------|
| `from` / `to` | `import` / `require` / `import()` 里的字符串前缀或整串 |
| `kind` | 省略或 `"prefix"`（默认）：整串相等 **或** `from/` + 后缀；`"exact"`：仅整串相等 |

`from` 更长的优先。目录改名时建议同时写 `@/util/` 与 `@/util`。

## 命令

```bash
node 2to3/bin/migrate.js --to <底座根> --step path-remap
node 2to3/bin/apply-path-remap.js <底座根>
node 2to3/bin/apply-path-remap.js <底座根> --dry-run
node 2to3/bin/apply-path-remap.js <底座根> --stub
```

## 范围硬规则

- **只**处理 `ingest-files.txt`（或 `--files-from`）列出的路径。
- **不**扫整棵树 — AI 自建底座文件不动。
- 没有非空 ingest 清单 → 脚本**拒绝**执行。
- `mappings` 为空 → 成功跳过。

## AI 清单

1. 对比源布局与底座（`util`/`utils`、axios 位置、alias）。
2. 填 `path-remap.md` 表，并同步 `path-remap.json`。
3. 跑 `--step path-remap`。
4. 再 `--step check`；若缺引用仍是旧前缀，补映射重跑。

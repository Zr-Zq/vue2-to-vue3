# 缺失引用检测：文件格式与作用（给 AI）

## 作用

在迁移**全部功能完成后**做必要收尾：检查底座工程里本地 `import` / `require` / `import()` / `export from` 等路径是否指向真实存在的文件。

- **脚本位置（本仓库，勿用用户全局 skill）**：`2to3/scripts/check-import-refs.mjs`
- **入口包装**：`2to3/bin/check-refs.js`（`v23-check-refs`）
- **有缺失时**：把结果交给 AI，由 AI 确认是「补文件 / 改引用 / 可忽略误报」

别名解析来自被检项目向上找到的 `jsconfig` / `tsconfig` / `webpack.config.*` / `vite.config.*` 等（`@`、`~` 等）。

---

## 怎么跑

```bash
node 2to3/bin/check-refs.js <底座根>
node 2to3/bin/check-refs.js <底座根> --all
node 2to3/bin/check-refs.js <底座根> --files-from <清单.txt>
```

底层等价于：

```bash
node 2to3/scripts/check-import-refs.mjs <底座根> --json [--files-from list.txt]
```

| 退出码 | 含义 |
|--------|------|
| 0 | 通过（无缺失） |
| 1 | 有缺失或未通过 |
| 2 | 包装脚本找不到检测器等配置错误 |

---

## 产出文件（均在 `<底座>/.v23/`）

| 文件 | 作用 |
|------|------|
| `missing-refs.json` | 规范化后的完整结果，程序/AI 优先读这个 |
| `missing-refs-for-ai.md` | 给人/AI 看的路径:行号清单 |
| `missing-refs.raw.txt` | 底层脚本原始 stdout/stderr |
| `ingest-files.txt` | ingest 写入的「本次摄入文件」列表（默认检查范围） |
| `all-src-files.txt` | `--all` 时生成的全 src 列表 |

---

## `missing-refs.json` 格式

### 通过时

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

### 未通过时

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

### `missing[]` 字段（包装后统一英文键）

| 字段 | 类型 | 含义 |
|------|------|------|
| `file` | string | **引用方**文件（相对项目根），AI 打开这个文件 |
| `line` | number\|null | 出问题的行号 |
| `specifier` | string | 源码里的导入字符串，如 `@/utils/x`、`./Child.vue` |
| `missing` | string | 解析后认为应存在、但磁盘上找不到的路径 |
| `project` | string\|null | 解析时锚定的子项目标识（多包仓时有用） |
| `raw` | object | 底层原始条目（可能含中文键） |

### 底层脚本原始失败 JSON（`raw` / `missing-refs.raw.txt`）

底层 `--json` 且失败时，stdout 形如：

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

中文键与英文键对应：

| 中文键 | 英文键 |
|--------|--------|
| 引用文件 | file |
| 行号 | line |
| 导入语句 | specifier |
| 缺失路径 | missing |
| 项目 | project |

成功且带 `--json` 时底层还会带：`ok`、`aliases`、`checkedFiles` 等。

---

## `missing-refs-for-ai.md` 格式

```markdown
# 缺失引用（请 AI 确认）

- 项目: `...`
- 共 N 条

1. `src/views/Foo.vue:12`
   - 导入: `@/components/Bar.vue`
   - 缺失路径: `src/components/Bar.vue`
```

AI 处理约定：

1. 按 `` `file:line` `` 打开文件。
2. 看 `导入` 是否写错、或目标文件未 ingest。
3. 补文件 / 改路径 / 标明可忽略后，再跑一次 `v23-check-refs` 直到 `ok: true`。

---

## 能力边界

- **覆盖**：本地相对路径、项目 alias；省略后缀与 `index`。
- **跳过**：npm 包名、URL、`node:` 等。
- **不保证**：纯动态拼接路径、运行时才拼出的模块名。

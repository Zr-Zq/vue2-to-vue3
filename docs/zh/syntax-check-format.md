# 语法检查：文件格式与用途（给 AI）

## 用途

迁移功能做完后，和缺引用检查一起跑。它报告无法解析的代码：

- JSON 对象（严格）。`tsconfig.json` / `jsconfig.json` 允许注释和尾逗号
- 严格 JSON 里的重复 key
- JS / TS / Vue `<script>` 与 `<script setup>` 解析错误
- 声明和标识符错误（`const` / `let` 缺初始值、词法重名、保留字）的 `kind` 为 `"binding"`

模板 HTML 不按 JavaScript 解析。`.d.ts` 跳过。

- **脚本**：`2to3/scripts/check-syntax.js`
- **入口**：`2to3/bin/check-syntax.js`（`v23-check-syntax`）
- **失败时**：改迁移结果或迁移器。不要改源夹具来藏住错误。

## 怎么跑

```bash
node 2to3/bin/check-syntax.js <底座根>
node 2to3/bin/check-syntax.js <底座根> --all
node 2to3/bin/check-syntax.js <底座根> --files-from <清单.txt>
node 2to3/scripts/check-syntax.js --self-test
```

`v23-migrate --step check` 会在 `v23-check-refs` 之后跑本检查。一边失败时，另一边仍会写出报告。

| 退出码 | 含义 |
|--------|------|
| 0 | 无问题 |
| 1 | 有一条或多条问题 |

范围：`src/**`、根目录 `*.json`、旁路目录（`script/`、`test/` …）。跳过 `node_modules`、`dist`、`.v23`。

## 产物（在 `<底座>/.v23/`）

| 文件 | 作用 |
|------|------|
| `syntax-issues.json` | 机器可读结果 |
| `syntax-issues-for-ai.md` | 给 AI 的路径:行号清单 |

## `syntax-issues.json`

通过：

```json
{
  "ok": true,
  "projectRoot": "D:/.../app",
  "total": 0,
  "issues": []
}
```

失败条目：

| 字段 | 含义 |
|------|------|
| `file` | 相对项目根的路径 |
| `line` / `column` | 从 1 开始 |
| `kind` | `json`、`json-duplicate-key`、`binding`、`syntax`、`vue-sfc` |
| `message` | 解析器或 JSON 的消息 |

## AI 要做的

1. 打开 `syntax-issues-for-ai.md`。
2. 修迁移后的文件（坏 JSON、非法声明、截断的 script）。
3. 若是迁移器写出的坏语法，改 `2to3` 再跑流水线。`1.pure-vue-app`、`2.pure-vue-app`、`my-vue-app` 保持不动。
4. 再跑 `v23-check-syntax`，直到 `ok: true`。

执行迁移时以 `docs/en/syntax-check-format.md` 为准。

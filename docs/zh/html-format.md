# HTML（template）处理：格式与作用（给 AI）

## 作用

Vue SFC 拆成 **HTML + JS** 后，本模块只处理 **`<template>` 内的 HTML**：

- 扫描标签 / 属性 / `{{ }}` 插值（带行号）
- 产出 Vue2toVue3 相关 findings
- **不改业务逻辑**；风险插件据此写入 `AI-TODO`（HTML 注释）

脚本入口：`2to3/src/analyze-html.js`  
拆解入口：`2to3/src/sfc-parts.js`（`template` to `kind: 'html'`）

---

## API

```js
const { analyzeVueHtml, analyzeHtmlTemplate, scanHtml } = require('./src/analyze-html')

// 整份 .vue
const r = analyzeVueHtml(vueSource, absPath, fileRel)

// 仅 template 字符串
const r2 = analyzeHtmlTemplate(templateCode, { file, range, templateAttrs })
```

### 返回结构

| 字段 | 含义 |
|------|------|
| `kind` | 固定 `'html'` |
| `elements[]` | 开/闭标签；含 `tag` / `attrs` / `attrsMap` / `loc` |
| `interpolations[]` | `{{ }}`；含 `filters[]` |
| `findings[]` | 迁移风险（见下） |
| `summary` | 标签/指令计数、finding 汇总 |

`loc` 在传入 `range.startLine`（SFC 内 template 偏移）后为**文件绝对行号**；原始相对行在 `templateLoc`。

---

## findings 字段

| 字段 | 含义 |
|------|------|
| `id` | 如 `html.v-for-v-if` |
| `category` | 与 risks 一致：`filters` / `legacy-slot` / … |
| `level` | `info` / `warn` / `block` |
| `auto` | `yes` / `partial` / `no` |
| `part` | 固定 `'html'` |
| `file` | 项目相对路径 |
| `message` / `evidence` / `hint` | 说明 |
| `loc` | `{ line, column }` |

### 已覆盖类别

- `v-for-v-if` — 同节点 `v-for` + `v-if`
- `filters` — 插值 / 绑定中的 `|`
- `native-modifier` — `.native`
- `sync-modifier` — `.sync`
- `dynamic-args` — `:[x]` / `@[x]`
- `legacy-slot` — `slot` / `slot-scope` / 与 `v-slot` 混用
- `keepalive-combo` — `<keep-alive>` / `:is`（组合判断在 `risk-keepalive-combo`）
- `functional` — `<template functional>`

---

## 流水线产出

跑 `v23-run` / 前置风险后：

| 文件 | 作用 |
|------|------|
| `.v23/risks.json` | 全量风险（含 `part: "html"`） |
| `.v23/html-risks.json` | 仅 HTML 风险 + 每文件 summary |
| `graph.json` to `files[].html` | 分析阶段挂上的 html 摘要 |

AI 处理：按 `file:line` 打开，改 template；注释为 `<!-- 迁移脚本注释: AI-TODO … -->`。

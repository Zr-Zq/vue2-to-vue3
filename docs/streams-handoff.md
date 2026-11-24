# HTML 流 / JS 流与交接文件

## 原则

- **HTML 流**：只改 `<template>` / `<style>`（如 `.sync`、slot、`|filter`→调用、`:deep()`）。
- **JS 流**：只改 `<script>` / 选项对象（如 `filters→methods`、`render(h)`、生命周期）。
- 两边有依赖时，**不互相硬耦合**：HTML 写交接，JS 消费；JS 找不到就 **skip**。

## 交接文件

路径：`<项目>/.v23/handoff.json`

HTML 把 `|upper` 改成 `upper()` 后登记：

```json
{
  "kind": "filters-to-methods",
  "fromStream": "html",
  "toStream": "js",
  "toPlugin": "migrate-filters",
  "file": "src/fixtures/pure-vue2/edge-coverage.vue",
  "filters": ["upper"],
  "status": "pending"
}
```

JS 流 `migrate-filters`：

| 情况 | status |
|------|--------|
| 找到 `filters` 并并入 `methods` | `done` |
| 无 `filters`（已改过 / 不存在） | `skipped`（不算失败） |

## 流水线预设

`v23.pipeline.js` 里 `preflightPipeline` 可写：

| 值 | 含义 |
|----|------|
| `'html-only'` | 仅 HTML 流 + 少量风险汇总 |
| `'js-only'` | 仅 JS 流（读 handoff） |
| `'full'` / 数组 | 完整 HTML→JS→风险 |

示例：

```js
module.exports = {
  dryRun: false,
  preflightPipeline: 'html-only', // 预览模板
}
// 之后再：
// preflightPipeline: 'js-only'
```

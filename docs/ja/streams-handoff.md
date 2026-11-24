# HTML ストリーム / JS ストリームと引き渡しファイル

## 原則

- **HTML ストリーム**：`<template>` / `<style>` のみ変更（例：`.sync`、slot、`|filter`→呼び出し、`:deep()`）。
- **JS ストリーム**：`<script>` / オプションオブジェクトのみ変更（例：`filters→methods`、`render(h)`、ライフサイクル）。
- 双方に依存がある場合、**互いにハード結合しない**：HTML が引き渡しを書き、JS が消費する；JS 側で見つからなければ **skip**。

## 引き渡しファイル

パス：`<プロジェクト>/.v23/handoff.json`

HTML が `|upper` を `upper()` に変えたあと登録：

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

JS ストリーム `migrate-filters`：

| 状況 | status |
|------|--------|
| `filters` を見つけて `methods` にマージ | `done` |
| `filters` なし（既に変更済み / 存在しない） | `skipped`（失敗ではない） |

## パイプラインプリセット

`v23.pipeline.js` の `preflightPipeline` には次を書けます：

| 値 | 意味 |
|----|------|
| `'html-only'` | HTML ストリームのみ + 軽いリスク集計 |
| `'js-only'` | JS ストリームのみ（handoff を読む） |
| `'full'` / 配列 | 完全な HTML→JS→リスク |

例：

```js
module.exports = {
  dryRun: false,
  preflightPipeline: 'html-only', // テンプレートをプレビュー
}
// その後：
// preflightPipeline: 'js-only'
```

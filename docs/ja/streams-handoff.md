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
| 既存 method と同名 — method を残し、filter は `__v23Filter_<name>`、mustache / `v-bind` 呼び出しを書き換え | `done` |
| `filters` なし（既に変更済み / 存在しない） | `skipped`（失敗ではない） |

## パイプラインプリセット

`v23.pipeline.js` の `preflightPipeline` には次を書けます：

| 値 | 意味 |
|----|------|
| `'html-only'` | HTML ストリームのみ + 軽いリスク集計 |
| `'js-only'` | JS ストリームのみ（handoff を読む） |
| `'full'` / 配列 | 完全な HTML→JS→リスク |
| カスタム配列 | 例: リスクのみ（HTML quirks + JS リスク + `risk-options-composition` + 注釈）。`2.pure-vue-app` が Options→Composition 書き換え前に使用 |

例：

```js
module.exports = {
  // ソースは書き換えない。インプレース書き戻しは v23-run <project> --write が必要
  dryRun: true,
  preflightPipeline: 'html-only', // テンプレートをプレビュー
}
// その後：
// preflightPipeline: 'js-only'
```

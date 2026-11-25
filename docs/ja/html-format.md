# HTML（template）処理：形式と役割（AI 向け）

## 役割

Vue SFC を **HTML + JS** に分割したあと、本モジュールは **`<template>` 内の HTML** のみを扱います：

- タグ / 属性 / `{{ }}` 補間を走査（行番号付き）
- Vue2toVue3 関連の findings を出力
- **業務ロジックは変更しない**；リスクプラグインがこれに基づき `AI-TODO`（HTML コメント）を書き込む

スクリプト入口：`2to3/src/analyze-html.js`  
分割入口：`2to3/src/sfc-parts.js`（`template` to `kind: 'html'`）

---

## API

```js
const { analyzeVueHtml, analyzeHtmlTemplate, scanHtml } = require('./src/analyze-html')

// .vue 全体
const r = analyzeVueHtml(vueSource, absPath, fileRel)

// template 文字列のみ
const r2 = analyzeHtmlTemplate(templateCode, { file, range, templateAttrs })
```

### 戻り値の構造

| フィールド | 意味 |
|------------|------|
| `kind` | 固定 `'html'` |
| `elements[]` | 開/閉タグ；`tag` / `attrs` / `attrsMap` / `loc` を含む |
| `interpolations[]` | `{{ }}`；`filters[]` を含む |
| `findings[]` | 移行リスク（下記） |
| `summary` | タグ/ディレクティブ件数、finding 集計 |

`loc` は `range.startLine`（SFC 内 template のオフセット）を渡すと**ファイル絶対行番号**になります。元の相対行は `templateLoc` にあります。

---

## findings フィールド

| フィールド | 意味 |
|------------|------|
| `id` | 例：`html.v-for-v-if` |
| `category` | risks と同じ：`filters` / `legacy-slot` / … |
| `level` | `info` / `warn` / `block` |
| `auto` | `yes` / `partial` / `no` |
| `part` | 固定 `'html'` |
| `file` | プロジェクト相対パス |
| `message` / `evidence` / `hint` | 説明 |
| `loc` | `{ line, column }` |

### カバー済みカテゴリ

- `v-for-v-if` — 同一ノードの `v-for` + `v-if`
- `filters` — 補間 / バインド中の `|`
- `native-modifier` — `.native`
- `sync-modifier` — `.sync`
- `dynamic-args` — `:[x]` / `@[x]`
- `legacy-slot` — `slot` / `slot-scope` / `v-slot` との混用
- `keepalive-combo` — `<keep-alive>` / `:is`（組み合わせ判定は `risk-keepalive-combo`）
- `functional` — `<template functional>`

---

## パイプライン成果物

`v23-run` / 前置リスク実行後：

| ファイル | 役割 |
|----------|------|
| `.v23/risks.json` | 全量リスク（`part: "html"` を含む） |
| `.v23/html-risks.json` | HTML リスクのみ + ファイルごとの summary |
| `graph.json` to `files[].html` | 分析段階で付与された html 要約 |

AI の処理：`file:line` で開き template を修正。コメントは `<!-- migrate-script note: AI-TODO … -->`（中国語レガシー：`<!-- 迁移脚本注释: AI-TODO … -->`）。

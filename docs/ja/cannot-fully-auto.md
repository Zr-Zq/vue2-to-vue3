# 完全自動できない項目一覧（人手 / AI の判断が必要）

前置リスクパイプラインは下記項目を**検出し登録**でき、デフォルトでは**ロジックを変更しません**。ソースへ次を挿入するだけです：

`/* migrate-script note: AI-TODO [category] … */`  
（中国語レガシー表記：`迁移脚本注释: AI-TODO`）  
（テンプレート内は `<!-- migrate-script note: AI-TODO … -->` / 中国語レガシー `<!-- 迁移脚本注释: AI-TODO … -->`）

AI がコメントを逐項処理します。スクリプト側はセマンティクスの書き換えを行いません。

**本一覧に含めず、スクリプトも移行しない：** `.env*` / `VUE_APP_*`↔`VITE_*` / `process.env`↔`import.meta.env` および工程設定——**AI が Vue3 ベースを作るとき**に処理（`ai-scaffold-notes.md` 参照）。

**すでにスクリプトで確定処理でき、危険扱いしないもの（本一覧に含めず、AI-TODO も付けない）：**

- `.sync` → `v-model:`、`.native` 削除、旧 slot → `v-slot`
- `keep-alive` + `:is` → `:key` を補完
- インスタンス `$on` / `$off` / `$once` → `this.$bus.*` + `src/compat/v23-bus.js` をコピー/登録
- `render(h)` → h 引数削除 / data 平坦化 / `$scopedSlots→$slots`
- `Vue.extend` → `defineComponent`；`$mount` → `createApp().mount`
- `$children` → `__v23Children(this)` による近似
- ライフサイクル `beforeDestroy`/`destroyed` → `beforeUnmount`/`unmounted`
- `this.$set`/`Vue.set` → 代入；`$delete`/`Vue.delete` → `delete`
- `$listeners` → `$attrs`；テンプレート `v-on="$listeners"` → `v-bind="$attrs"`
- カスタムディレクティブのフック名マッピング（`bind`→`beforeMount` など）
- テンプレートの `|` フィルタ → 関数呼び出し（HTML ストリーム）；`filters`→`methods`（JS ストリーム、`.v23/handoff.json` 経由。見つからなければ skip）
- `>>>` `/deep/` `::v-deep` → `:deep()`
- `Vue.config.productionTip` / `silent` 代入の削除
- `<template functional>` / `functional: true` → 通常コンポーネント（`$props`/`$attrs`、`listeners` 削除）

---

1. **同一ノードの `v-for` + `v-if`** (`v-for-v-if`)  
   **同一要素上にある場合のみ**——AI が移行（典型：`<template v-for :key>` + 内側 `v-if`）。  
   **別タグ上**：対応不要（登録しない）。

2. **`$parent` / `$root` などインスタンスツリー API** (`instance-api`)  
   実行時のコンポーネントツリーに依存。`$children` / `$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` はスクリプトで処理済み。

3. **子コンポーネントによる props 変更（間接 / 別名）** (`props-mutation`)  
   直接代入は検出可能；分割代入、別名、透過後の変更は漏れることがある。

4. **mixin 同名マージ優先度 / グローバル mixin 注入** (`mixin-collision`)  
   マージ戦略と影響範囲はプロダクト判断が必要。盲目的なマージは不可。

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` のグローバル副作用** (`global-side-effect`)  
   app 級 API へ移行が必要；`productionTip`/`silent` はスクリプトで削除済み。`keyCodes`、`prototype`、`mixin` は依然として人手対応。

6. **`setup` と Options の混用方針** (`setup-mix`)  
   混用継続か全面 Composition かはアーキテクチャ選択。

7. **`provide` のプリミティブが非リアクティブ** (`provide-primitive`)  
   `ref` で包むとすべての inject 側の取り方が変わる。

---

検出結果は実行後の次を参照：

- `<project>/.v23/risks.json`（`--keep` 時に保持）
- リポジトリ `output/<project>-risks/`（実行のたびにバックアップ）

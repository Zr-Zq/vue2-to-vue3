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
- `Vue.extend` / `Sub.extend` → `new` できる `__v23Extend`（`src/compat/v23-extend.js`）：関数のままなので動的な `new variable()` と `typeof Ctor === 'function'` は維持される。直接または別名の呼び出し（`new SomeExtend()` / `const Ctor = SomeExtend; new Ctor()`、同一ファイルまたは import）→ `__v23New(Ctor, extra)`。`$mount` → `createApp().mount`
- Options→**`<script setup>`**（`defineComponent` なし）：`data`→`ref`、`computed`（get/set）、`watch`、`provide`/`inject`、`filters`→methods、ライフサイクル→`onXxx`（`beforeCreate` + `created` を順に直書き）、`defineProps`/`defineEmits`/`defineOptions`、directives→`vName`、公式 `$`、mixin 平坦化、bind/call と `this._*` 分析；`migrate-options-composition`。**`options.model`→AI**
- **非同期ファクトリ** → `defineAsyncComponent`（`() => import()`、`loading`/`error`/`delay` オブジェクト、`Vue.component('X', () => import())`）；`migrate-async-component`。Options→setup 時はローカル `components`（非同期含む）を `defineOptions.components` へインライン
- **TS は既存型のみ搬送**（発明しない）：`data(): { x: T }` → `ref<T>`；既存 `PropType` / メソッド注釈は `defineProps` / 関数に残す
- **options-composition の担当外**（`this.$…` は専用プラグインへ）：`$router`/`$route` → `router`；`$store` / `map*` → `vuex`；`$i18n`/`$t`/`$tc`/… → `i18n`
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

2. **`$parent` / `$children` / `$root` などインスタンスツリー API** (`instance-api`)  
   実行時ツリー依存——**`$parent` / `$children` / `$root` は AI 担当**（スクリプトは残して AI-TODO）。`$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` はスクリプト処理済み。

3. **子コンポーネントによる props 変更（間接 / 別名）** (`props-mutation`)  
   直接代入は検出可能；分割代入、別名、透過後の変更は漏れることがある。

4. **mixin 同名マージ優先度 / グローバル mixin 注入** (`mixin-collision`)  
   マージ戦略と影響範囲はプロダクト判断が必要。盲目的なマージは不可。

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` のグローバル副作用** (`global-side-effect`)  
   app 級 API へ移行が必要；`productionTip`/`silent` はスクリプトで削除済み。`keyCodes`、`prototype`、`mixin` は依然として人手対応。

   **AI スポットチェック（多い場合は最大 5 件）：** `createApp()` 側へ移し、呼び出し側が生きているか確認：

   | # | Vue2 | Vue3 先 | AI 確認 |
   |---|------|---------|---------|
   | 1 | `Vue.mixin({…})` | `app.mixin({…})` | ローカル mixin とのマージ順 / 同名衝突 |
   | 2 | `Vue.prototype.$foo = …` | `app.config.globalProperties.$foo` | `this.$foo` 呼び出し（型があれば型も） |
   | 3 | `Vue.config.errorHandler` | `app.config.errorHandler` | err / instance / info を受け取れるか |
   | 4 | `Vue.config.warnHandler` | `app.config.warnHandler` | 開発時警告が届くか |
   | 5 | `Vue.config.keyCodes` / `ignoredElements` | `keyCodes` は削除；カスタム要素は `app.config.compilerOptions.isCustomElement` | `.keyXxx` / Web Components が黙って壊れないか |

   `risks.json` の `global-side-effect` が 5 件超なら、**mixin / prototype / errorHandler / warnHandler / keyCodes|ignoredElements** を優先（欠けたら近いもので 5 件）。残りは AI-TODO のまま次パス。

   **サイドカー非 SFC の Options オブジェクト：** ルートの `script/`・`mock/`・`lib/` など（`sidecar-dirs.js`）に、`.vue` ではない素の `export default { data(){}, methods:{} }` があり得る。copy+パイプラインは script-setup 風に書き換えうるが、`defineProps`/`defineEmits` は SFC マクロのため、実コンポーネントは `.vue` へ移す。

6. **`setup` と Options の混用方針** (`setup-mix`)  
   混用継続か全面 Composition かはアーキテクチャ選択。

7. **`provide` のプリミティブ** (`provide-primitive`)  
   Options→Composition 時にスクリプトが `ref` で包み、inject 側向け AI-TODO を入れる（auto=`partial`）。  
   **範囲：** `provide` / `provide()` 戻りオブジェクトの字面 string/number/boolean/null。  
   **AI：** 生プリミティブとして読んでいた inject は Ref（`.value`）へ、または設計見直し。

8. **Options → Composition の残り** (`options-to-composition`)  
   **Options API のまま保持（変換しない）：** **import の** mixin または **`options.extends`** を持つコンポーネント — 1 ファイル内で平坦化できず、Vue3 も `mixins`/`extends` をサポートするため、AI-TODO `kept Options API (…)` のみ付与し、AI が書き換えるべき Vue2 専用インスタンス API（`$createElement`、`$vnode`、`$destroy`、`$children`、`_uid` …）を列挙。  
   なお AI（ラップアップ）：**`options.model`**、上記の Options 保持コンポーネント（Options のままか composable 化）、**`$children`**（Vue3 削除 → template ref）、子の **`$destroy`**、**`this.$options.methods`/`computed`/…**（script setup では空 → ローカル束縛を使う）、素の `.js`/`.ts` Options。ラップアップ後は **AI-TODO 表記を削除**。  
   **確定パス済み：** `this.$el` / 裸 `$refs` / `$parent` / `$root` / `$options` / `$forceUpdate` → `__v23Proxy?.…`、`$vnode` / `$destroy` → `__v23Proxy?.$.…`（proxy は setup で取得するためメソッド内でも安全）；`$ssrContext` → setup で取得した `useSSRContext()`（SSR ビルドのみ）；`data()` prelude/短縮/`this.prop` → IIFE/`props.*`；ローカル `components` を `defineOptions.components` へインライン（文字列 `:is`）；`defineExpose`。  
   **data の `this._xxx`：** `_xxx` が `data()` キーなら他 data 同様 ref 化（+ AI-TODO：Vue2 はアンダースコアをインスタンスにプロキシしない）。data 以外のカスタムフィールド（例 `this._timer = …`）→ インスタンスごとのプレーンオブジェクト `__v23Self._xxx`（非リアクティブ、Vue2 と同じ）。Vue 内部 `_uid` などは `this._*` のまま。

**関連する確定パスのエッジ（テストあり；「リスク」ではないが範囲あり）：**

| 題材 | スクリプト | 範囲外 |
|------|------------|--------|
| `$mount` + `router`/`store` | 省略記法も `router: x` も `.use(…)` へ（`{` 直後の先頭キー含む） | pinia / i18n / 独自プラグイン |
| `Vue.extend` / `Ctor.extend` | `__v23Extend`（関数）。`new` 呼び出し（別名・import 含む）は `__v23New`。`new Ctor()` は `createApp` でマウント；コンポーネントとしては状態付き定義を描画。`extends` は基底ラッパーを剥がす | `new Ctor({ data, store, router })` の `propsData` / `el` 以外；import でもローカル束縛でもない自由グローバルの `new` |
| 同一ファイル `mixins: [mid]` | `mid.mixins` → mid → host を再帰 | `import` の mixin（コンポーネントは Options API のまま） |
| import の mixin / `extends` | Options API 保持 + AI-TODO（`<script setup>` へ変換しない） | composable の自動抽出 |
| 素の `.js`/`.ts` Options / mixin | 検出 + AI-TODO；`export default` を**保持** | `.vue` 外で `<script setup>` へ自動変換 |
| `data()` 短縮 / `this.prop` 初期値 | IIFE または `props.*`（TDZ 回避） | data() 内の非 prop `this` |
| components + 文字列 `:is` | ファクトリを `defineOptions({ components })` へインライン（setup 外へ巻き上げられるため script setup のローカルは参照不可）；モジュールローカルを参照するファクトリ → `const` のみ（タグ用） | テンプレート `:is` 文字列の書き換え |
| `data()` キーが import と同名 | 内部 ref をリネーム；import を再宣言するエイリアスは出さない | — |
| 親 `$refs` から子メソッド | `defineExpose` methods/data/computed | 選択的 expose 方針 |
| `filters` と `methods` 同名 | method を残し、filter は `__v23Filter_<name>` としてマージ；mustache / `v-bind` の呼び出しを書き換え（Vue2 の filter はそこだけ）。イベントは method のまま | グローバル `Vue.filter`；スクリプトの `this.$options.filters` |
| 非同期 `() => import()` / loading·error·delay オブジェクト | → `defineAsyncComponent`（フィールド対応）；既に `defineAsyncComponent` 内の factory は再ラップしない | 独自 Promise loader（`import` 以外）；スプレッド / 未知キーを含むオプションオブジェクトはそのまま（損失のある書き換えをしない）；ルートレコードの `component: () => import()` は素の loader のまま |
| Vue Router 3 モジュール（`router` プラグイン、既定 `migrate`） | `new VueRouter` → `createRouter` + `createWebHistory`/`createWebHashHistory`/`createMemoryHistory`（`mode`/`base` から；mode なし → hash）、`*` → `/:pathMatch(.*)*`、`scrollBehavior` x/y → left/top、`addRoutes` → `addRoute`、`onReady` → `isReady`、`currentRoute` → `.value`、`Vue.use` / prototype `push` パッチ削除；`<script setup>` 内の `this.$route`/`$router` → `useRoute()`/`useRouter()` | `getMatchedComponents` / `router.match`（AI-TODO）；ガードの `next` 意味論；Options のまま残すコンポーネントは `this.$route` のまま |
| 連結 / テンプレート文字列パスの動的 `import()` | `import('@/views/' + n + '.vue')` → `import.meta.glob('<相対ディレクトリ>/**/*.vue')` + キー参照（無い場合は webpack 同様に reject） | 拡張子サフィックスなし、ベアパッケージ接頭辞、完全に動的なパス |
| ソース上の既存 TS 注釈 | `ref<T>` / `defineProps` / メソッド署名へ搬送 | 注釈が無いのにジェネリクスや PropType を発明 |
| `ingest` コピー | スタイル/アセット（scss/css/画像/フォント…）もコピー；import 書き換えで `.vue` 拡張子を保持 | env / 工程設定（AI ベース） |

9. **`vue-class-component` / デコレータ** (`typescript-class`)  
   `@Component` / `@Prop` / `@Watch` / `vue-property-decorator` など：**検出 + AI-TODO のみ**——スクリプトは Options / `<script setup>` へ**自動変換しない**。  
   **AI：** まず Options へ、または Composition を手移行；必要なら JS ストリームを再実行。

---

検出結果は実行後の次を参照：

- `<project>/.v23/risks.json`（`--keep` 時に保持）
- リポジトリ `output/<project>-risks/`（実行のたびにバックアップ）

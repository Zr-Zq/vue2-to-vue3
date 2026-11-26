# AI ベース初期化：注意事項

移行の第 2 ステップは **AI が移行先プロジェクトのベースを作成**します（`--to`）。ベース技術スタックは **Vue 3**（Vite 優先）。スクリプトの `--scaffold` は旧 Vue2 テンプレートのコピーに過ぎず、**正式移行では使わない**でください。

### 役割分担（必須）

| 誰 | 担当 |
|----|------|
| **AI** | **Vue3** ベース作成；**すべての**工程設定；依存インストール；**起動できる**；レイアウトは**スクリプトとシームレスに接続** |
| **スクリプト** | analyze / copy / 確定的な構文移行 / AI-TODO / check-refs；**`.env*`・`VUE_APP_*`↔`VITE_*`・`process.env`↔`import.meta.env` は触らない** |

### ベース完了基準（スクリプト copy の前）

AI は空シェルで止めず、次までやり切ること：

1. **工程設定すべて**を Vue3 + Vite 向けに再現 / アップグレード（下表）。
2. **`package.json` が揃っている**：Vue3 スタック + ソースが要する runtime/dev 依存。
3. **`--to` で依存インストール済み**（`npm install` / pnpm / yarn）；`node_modules` あり。
4. **開発サーバが起動する**：`npm run dev`（または起動スクリプト）がモジュール/設定不足なく立ち上がる。業務ページは copy 待ちでよいが、入口/ルーターのスタブは動くこと。
5. env、alias、proxy、public、lint/tsconfig、CDN 判断が既に入っている。
6. **スクリプトとシームレス**：AI 完了後すぐ `v23-migrate --from … --to … --step script`（またはデフォルト）を実行でき、追加のベース直し・`--scaffold`・env/工程設定の穴埋めが不要。

### スクリプトとのシームレス接続

ベースはスクリプトが既に仮定している形に合わせ、copy / import 書き換え / pipeline がそのまま繋がること：

| 要件 | 理由 |
|------|------|
| ルートに `package.json`（できれば `vite.config.*` と `jsconfig.json` / `tsconfig.json` も） | `looksLikeProject(--to)` が真であること；さもなくば migrate は「AI ベース待ち」で止まる |
| 既定のアプリツリーは **`src/`**（ソースの `--src` / `--dest-src` と一致） | スクリプト copy は相対パス；変則レイアウトは追加フラグが要る |
| エイリアス **`@` to `src`**（ソースが `~` も使っていれば同様）；`jsconfig`/`tsconfig` paths と Vite を一致 | `ingest` / `rewrite-imports` は**ベース**の alias で解決・書き換え；**`.vue` 拡張子を保持**（Vite）；ingest はスタイル/アセット（scss/css/画像/フォント）もコピー（SFC/JS のみではない） |
| ルート工程ファイルは AI のみが用意（env、Vite、package.json、lint…） | スクリプトは env/工程設定を**移行しない**——ベース側で既に正しいこと |
| スタブ `src/main.js` / router は copy で**上書きされてよい** | スクリプトが重ねられないレイアウトにしない。コピーされた Vue2 の `router/index.js`・レイアウトはパイプラインが移行する（`router` プラグイン to Vue Router 4、`migrate-dynamic-import` to `import.meta.glob`）。底座版を手で戻さ**ない** |
| 欠けた依存・alias・proxy をスクリプトに残さない | 引き渡し = AI 完了 to スクリプト copy+pipeline to 構文/意味の AI-TODO のみ |

ソースが `src` 以外のルートなら、対応する `--dest-src` を使い `.v23/scaffold-notes.md` に書く。既定は `src/`。

## ビルドツール：Vite 優先

- **デフォルトは Vite + Vue 3** でベースを作る（`create-vue` / 手書き `vite.config` いずれも可）。
- **webpack / vue-cli をデフォルトにしない**。ユーザーが明示した場合、またはソースが短期プレビューで webpack に強く依存する場合のみ。
- 推奨依存の方向：`vue@3`、`vue-router@4`、必要に応じて `pinia` または `vuex@4`、UI はソースに合わせる（例：Element Plus）。
- `--from` が `element-ui-demo`（または `element-ui` 利用アプリ）のとき：ベースは **Element Plus**、登録はソースの `Vue.use(ElementUI)` に揃える。スクリプト `element`（`mode: migrate`）が size / `type="text"` / 日付 format / パッケージパス / `el-submenu`→`el-sub-menu` を書き換え済み；AI は **アイコン**（`@element-plus/icons-vue`）、**`createApp().use(ElementPlus)`**、SCSS テーマ再構築、**`Locale.use`→ConfigProvider locale** を担当。
- 入口：`index.html` + `src/main.js`（または `.ts`）、`resolve.alias['@'] to src`。
- **環境変数**：ソースの `.env*` を AI が `VITE_*` に揃え、コードは `import.meta.env`（スクリプト待ちにしない）。
- **インストール**：AI 自身がパッケージマネージャで入れる。「依存は後で」をスクリプトやユーザーに残さない。

## ソースの「工程設定すべて」を再現

ベース作成時、AI は **移行元（`--from`）** を照合し、工程レベルの設定を**すべて**ベースへ移行 / 再現し、依存を入れて起動確認まで行う。空の Vite シェルだけを立ち上げて終わらせないこと。

### 必ず走査し処理する設定面

| 出典（例） | ベース側の対応 |
|------------|----------------|
| `package.json` dependencies / scripts | Vue3 エコシステムの等価パッケージへ上げ、業務スクリプトの意図（build/lint/analyz など）を残す |
| `vue.config.js` / `webpack.config.*` | `vite.config` へ変換：alias、proxy、publicPath、define、静的ディレクトリ、圧縮など |
| `.env*` / `process.env.VUE_APP_*` | **AI のみ**（スクリプトは env を触らない）：`VITE_*` + `import.meta.env`、変数名を揃える |
| `babel.config.*` / `.browserslistrc` | Vite では多くがデフォルト；特殊な polyfill/プラグインはベースまたは AI-TODO に記録 |
| `postcss` / `sass` / `less` 設定 | Vite で同名の能力を再現 |
| `eslint` / `prettier` / `editorconfig` | ベースへコピーし Vue3 構文向けに調整 |
| `jsconfig` / `tsconfig` paths | Vite alias と一致させる |
| `public/` 静的資産、favicon、未バンドル html | ベースの `public/` へコピー |
| `index.html` の meta / タイトル / 注入 | Vite ルートの `index.html` へ書き込む |
| パスエイリアス、CDN externals、gzip、分析プラグイン | Vite で `build.rollupOptions` / プラグインにより等価実装 |

原則：

- **セマンティクス整合**：ソースで「効いていた」設定は、ベースに対応項目があるか、明確な「非推奨/不要」説明を付ける（`to/.v23/scaffold-notes.md` に書いてよい）。
- **バージョンアップ**：設定再現は Vue2 ツールチェーンの丸写しではない。目標は **Vue3 + Vite 下での挙動等価**。
- 業務ページは引き続きスクリプト `copy` が流し込む；AI は **工程シェル + 設定 + 依存選定** を担う。

## CDN の扱い

まずリソースが「プロジェクト自身のパッケージ / Vue 技術スタック依存」かどうかを判断し、CDN を管理するか決める。

### 無視してよい（スキップ）

次を同時に満たす、または明らかに該当する場合、CDN を npm 依存に**変える必要はない**：

1. **純粋な HTML / 純粋な JS 断片**：Vue、Element、Vue Router、Vuex を使っていない（ページに `new Vue`、`Vue.use`、対応グローバルが業務フレームワークに関与していない）；または  
2. **独立したサードパーティ小ツール**：独自の使い方で業務フレームワークと無関係（統計、地図 SDK デモページ、単ページの小スクリプトなど）、かつソースの `package.json` にも同名パッケージ依存がない。

これらは `<script src="https://...">` / 外部 CSS を残してよい。`index.html` / 静的ページがベースへコピーされていれば十分。

### 必ず処理

次のいずれかに該当する場合、CDN を**飾りとして無視してはならない**：

| 状況 | 対応 |
|------|------|
| CDN が提供するのは **Vue / vue-router / vuex / Element**（または `package.json` に既にあるスタック） | ベースは **npm 依存 + import** に変更；CDN を削除（または条件化）し二重ランタイムを避ける |
| `webpack externals` / `vue.config` で上記ライブラリを CDN へ外出し | Vite では通常バンドルするか、明示的な `rollupOptions.external` + `index.html` 注入とし、グローバル名マッピングを明記 |
| 業務コードがグローバル `Vue` / `ELEMENT` / `VueRouter` / `Vuex` を前提 | モジュール import へ変更；短期的に CDN を残すならベース文書にグローバル名と読み込み順を明記 |
| 同一ライブラリが CDN と `package.json` の両方 | **package を優先**し重複 CDN を削除。二重 Vue インスタンスを防ぐ |

### 判断フロー（AI 向け）

```
index.html / 入口 html / ビルド externals を読む
  ├─ 参照は vue / router / vuex / element（または package にあるライブラリ）？
  │     to 必ず処理：npm 化または明示 external。静かに二重保持しない
  └─ 純粋なツール CDN で、工程が Vue スタック経由で読み込んでいない？
        to 無視可：そのまま public / html へコピー
```

判断できないときは `ai-todos.md` / `scaffold-notes.md` に `CDN` と記し、黙って捨てない。

## ルート級の独立ディレクトリ（`script/` / `test/` / `style/` …）

多くのレガシープロジェクトは **`src` の外**にもサイドカーがあります。例：

`script/`、`scripts/`、`test/`、`tests/`、`style/`、`styles/`、`mock/`、`docs/`、`static/`、`vendor/`、`cdn/`、ルート級 `assets/` など。

### 絶対に移行しない（ハード除外）

次はサイドカーとしてコピー/走査**しない**（ソースルートにあっても）：

`node_modules/`、`dist/`、`build/`、`coverage/`、`.git/`、`.v23/`、および一般的なビルドキャッシュディレクトリ。

ベースは自身で `npm install`；成果物はベースが再ビルドする。AI がベースを作るときもこれらをコピーしてはならない。

### スクリプト側（対応済み）

- **copy**：`v23-migrate` は `src` コピー後、ソースルートに実在する上記サイドカーを **`--to` の同名パスへディレクトリごとコピー**（上書き前にバックアップ）；`node_modules`/`dist` 等はホワイトリスト外かつハード除外。
- **pipeline / analyze**：デフォルト `include` はこれらの配下の js/ts/vue/css/html をカバー済み；Vue スタック構文がなければプラグインは通常自然に skip。

### AI 側の判断

| 状況 | 処理 |
|------|------|
| ディレクトリが存在する | 必ずベースへ入れる（`src` だけ移行して終わりにしない） |
| 純粋 HTML/JS で、Vue / Element / Router / Vuex を**使っていない** | **書き換え不要**：そのまま残す（CDN「無視可」と同様） |
| `new Vue` / `from 'vue'` / element / router / vuex を含む | パイプライン移行へ；通らなければ AI-TODO |
| テスト実行が Jest/Karma 等に依存 | 対応設定を Vite/Vitest へ再現（または scaffold-notes に記録） |

判断の口訣：まず **コピーする** ことを保証し、Vue スタックかどうかで **書き換えるか** を決める。

## ベースの最小構成

```
<to>/
  package.json              # ソースをアップグレードしたスタックに揃えた依存
  vite.config.js
  index.html                # 残すべき非フレームワーク CDN を含む（あれば）
  .env* / .editorconfig / eslint など（ソースから再現）
  public/
  src/
    main.js
    App.vue
    router/                 # 先に空シェル可。copy 後に接続
  .v23/scaffold-notes.md    # 任意：設定/CDN 判断の説明
  .gitignore
```

- `npm install` が通ること；`npm run dev` で空白シェルが開けば十分。
- ベースに業務ページを**事前投入しない**；業務はスクリプト `copy/ingest` が `--from` から流し込む。

## 既知の落とし穴（ベース作成 / プレビュー時）

### 1. 複数の `<style>` と vue-loader@15（webpack 経路のみ）

一時的に **webpack + vue-loader@15**（Vue2 試験プレビュー）を使う場合：

- 同一 `.vue` に複数 `<style>` があると、よく誤検知が出る：
  `export 'default' (imported as 'style0'|'style1'|…) was not found`
- **移行が CSS を壊したわけではない**；スタイルは通常注入/抽出済みなので無視してよい。
- webpack 設定の推奨：

```js
ignoreWarnings: [
  { message: /export 'default' \(imported as 'style\d+'\) was not found/ },
]
```

- **Vite ベースにはこの問題がない**ため、正式な Vue3 ベースは Vite 優先。

### 2. Vue2 プレビュー vs Vue3 ベース

- `my-vue-app` / HTML プレビュー流は Vue2 + webpack のままでもよく、テンプレート書き換えの受け入れ専用。
- **移行先 `--to` は Vue3 + Vite** であること；Vue2 試験工程を最終ベースにしない。

### 3. ソース工程の保護

- ユーザーが「削除禁止」と明示したソースディレクトリ（例：`my-vue-app`）：追加・編集のみ。削除や `/MIR` での空クリアはしない。
- 移行出力は独立した `--to` / `output/...` へ書き、ソースと分離する。

### 4. HTML / JS 分流

- HTML 流のあとに JS 流を回す場合は `<to>/.v23/handoff.json` を見る。
- テンプレートの `|filter`to関数呼び出し後は、JS 流の `migrate-filters`（または handoff 消費）が必要；見つからなければ skip。

## AI 自己チェックリスト

ベース作成後に確認（注記がない限りすべて必須）：

1. [ ] **Vite + Vue3** を使っている（ユーザーが別途要求した場合を除く）
2. [ ] ソースの **工程設定すべて**を再現/等価移行済み（env、alias、proxy、lint、public、スクリプトなど）
3. [ ] **依存を書き足してインストール済み**（`npm install` / pnpm / yarn；スタックに必要なモジュールが欠けない）
4. [ ] **`npm run dev`（または起動スクリプト）が実際に起動する**（設定/モジュールエラーなし）
5. [ ] **スクリプトとシームレス**：`looksLikeProject` OK；`src/`（または文書化した dest-src）；`@` alias；env/工程設定の穴埋めをスクリプトに残さない
6. [ ] **CDN**：フレームワーク類は npm 化または明示 external；無関係な純粋 HTML/JS CDN は残してよい
7. [ ] ルート級 **`script/` / `test/` などサイドカー**をベースへコピー済み；非 Vue スタックは書き換え不要でもよい
8. [ ] `@` to `src` alias を設定済み（paths と Vite が一致）
9. [ ] ソースプロジェクトのファイルを誤削除していない
10. [ ] webpack の複数 style 誤検知を移行失敗と扱っていない
11. [ ] （推奨）`.v23/scaffold-notes.md` に設定・CDN・サイドカー・非既定 dest-src を記録
12. [ ] ベースがソースとパスを変えた場合（`util`→`utils`、axios など）は `.v23/path-remap.md` + `path-remap.json` を埋め `--step path-remap`（`path-remap.md`；`ingest-files.txt` のみ）

# 2to3 移行ワークフロー（スクリプト + AI）

## 入力

| パラメータ | 意味 | 例 |
|------------|------|----|
| `--from` | 移行元プロジェクトのルート | `D:/old-app` |
| `--src` | ソース内ディレクトリ（from 相対） | `src` |
| `--to` | 移行先ルート（ベース） | `D:/new-app` |
| `--dest-src` | 移行先内ディレクトリ（デフォルト=src） | `src` |

## ステージ順序

```
1. analyze     スクリプト：ソースプロジェクトを分析（グラフ / リスク手がかり）
2. scaffold    **AI**：Vue3 ベースを作成（**Vite**；設定完備 + 依存インストール + **起動可能** + **スクリプトとシームレス**；./ai-scaffold-notes.md 参照）
               · スクリプトの `--scaffold` を正式ベースにしない；**スクリプトは `.env*` / VUE_APP↔VITE を触らない**
3. copy        スクリプト：from/src to to/src；ルート級サイドカー（script/test/style/mock…）もコピー
               · 移行先に同名ファイルがある to 先に to/.v23/backup/<タイムスタンプ>/ へバックアップしてから上書き
               · ベースの alias に合わせて import を書き換え（env/工程設定は AI が準備済み）
4. pipeline    スクリプト：確定的な構文移行（sync/native/slot/render/mount/Element UI→Plus/…）
               · Element：size / type=text / underline / 日付 format / dialog v-model / パッケージパス；アイコンと Vue.use は AI-TODO
               · 安定して直せないものは AI-TODO；**環境変数・工程設定は移行しない**
5. 【一時停止】 AI：ai-todos.md を修正；ベースがディレクトリ名を変えた場合（util→utils、axios パスなど）は
               path-remap.md + path-remap.json を記入し `--step path-remap`（取り込みファイルのみ — path-remap.md）
6. check       スクリプト：v23-check-refs（ローカル参照の欠落）+ v23-check-syntax（JSON / JS / Vue script の構文）
7. 次ラウンド   通過後、必要なら再度 pipeline / path-remap / build で受け入れ確認
```

## コマンド

```bash
# 先に AI が Vue3 ベースを作成（設定完備 + 依存インストール + 起動可能）、その後スクリプトを実行
node 2to3/bin/migrate.js --from D:/old-app --src src --to D:/new-app

# ソースの分析のみ
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --step analyze

# AI が .v23/path-remap.json（レイアウト差分）を埋めたあと
node 2to3/bin/migrate.js --to D:/new-app --step path-remap

# AI が AI-TODO を直したあと
node 2to3/bin/migrate.js --to D:/new-app --step check

# スクリプト移行をもう一周
node 2to3/bin/migrate.js --to D:/new-app --step pipeline
```

## リポジトリ用フィクスチャ（移行元）

| パス | 役割 |
|------|------|
| `2.pure-vue-app` | Options→Composition + vue-router フィクスチャ（`--from`） |
| `1.pure-vue-app` | 旧テンプレの控えのみ；正式な Vue3 ベースにしない |
| `my-vue-app` | 混合 Vue2 フィクスチャ（ファイル削除禁止） |
| `element-ui-docs` | ElemeFE/element **公式ドキュメント**のフルクローン（全公式デモを閲覧）。ローカル手順は `element-ui-docs/README.local.md`（Node **16**、dart-sass パッチ）。通常の移行元レイアウトではない——UI 網羅テスト用。`--to` にしない。 |
| `element-ui-demo` | 任意：Vue2 + element-ui、`@`/`src` + 移行プローブ（あれば）を `--from` に。**`--to` は AI が Vite + Vue3 + Element Plus**。 |

例（`element-ui-demo` がある場合）：

```bash
node 2to3/bin/migrate.js --from element-ui-demo --src src --to output/element-ui-demo-migrate
```

## 役割分担

| 誰 | 何をするか |
|----|------------|
| スクリプト | 分析、copy+バックアップ、確定的な構文移行、AI-TODO 付与、欠落参照チェック、構文チェック；**`.env*` / 工程設定は触らない**。分析が書くのは `<from>/.v23` の報告だけ——**ソースファイルは書き換えない**。`v23-run` / `v23-pipeline` に `--write` を付けたときだけ書き戻す（移行の書き込み先は `--to`） |
| AI | **Vue3** ベース作成（Vite；**工程設定すべて**、**依存インストール**、**起動可**、**スクリプトとシームレス**）、AI-TODO 対応、欠落参照の確認、業務セマンティクスの判断 |

## 主要成果物（いずれも `<to>/.v23/` 配下）

| ファイル | 役割 |
|----------|------|
| `migrate-state.json` | 現在のステップ状態 |
| `migrate-copy.json` | 今回の copy 一覧とバックアップ |
| `backup/<タイムスタンプ>/` | 上書き前の旧ファイル |
| `ai-todos.md` | AI 待改一覧 |
| `risks.json` / `html-risks.json` | リスク詳細 |
| `missing-refs-for-ai.md` | 欠落参照の確認リスト |
| `syntax-issues.json` / `syntax-issues-for-ai.md` | JSON とスクリプト構文の問題 |
| `path-remap.md` / `path-remap.json` | AI レイアウト差分；`--step path-remap` は `ingest-files.txt` のみ |
| `ingest-files.txt` | 今回の copy が書いたファイル（check-refs / path-remap の範囲） |

## AI 必読

**AI は英語版のみ**（`../en/`）。以下は日本語対照；移行実行時は `docs/en/` の同名ファイルを開く。

- `../en/ai-scaffold-notes.md` — ベース初期化の注意（Vite 優先、style 誤検知など）
- `../en/html-format.md` — HTML/template findings
- `../en/streams-handoff.md` — HTML/JS 分流と `.v23/handoff.json`
- `../en/missing-refs-format.md` — 欠落参照 JSON
- `../en/syntax-check-format.md` — JSON / 宣言 / スクリプト構文チェック
- `../en/cannot-fully-auto.md` — 完全自動できない項目
- `../en/path-remap.md` — パスレイアウト差分と範囲限定の import 書き換え

# 構文チェック：ファイル形式と役割（AI 向け）

## 役割

移行機能のあと、欠落参照チェックと一緒に実行する。パースできないコードを報告する：

- JSON オブジェクト（厳密）。`tsconfig.json` / `jsconfig.json` はコメントと末尾カンマを許す
- 厳密 JSON の重複キー
- JS / TS / Vue `<script>` と `<script setup>` のパースエラー
- 宣言と識別子のエラー（`const` / `let` の初期化漏れ、レキシカル重複、予約語）は `kind: "binding"`

テンプレート HTML は JavaScript としてパースしない。`.d.ts` は対象外。

- **スクリプト**：`2to3/scripts/check-syntax.js`
- **入口**：`2to3/bin/check-syntax.js`（`v23-check-syntax`）
- **失敗時**：移行結果か移行器を直す。ソースのフィクスチャを書き換えてエラーを隠さない。

## 実行

```bash
node 2to3/bin/check-syntax.js <ベースルート>
node 2to3/bin/check-syntax.js <ベースルート> --all
node 2to3/bin/check-syntax.js <ベースルート> --files-from <list.txt>
node 2to3/scripts/check-syntax.js --self-test
```

`v23-migrate --step check` は `v23-check-refs` のあとで本チェックを実行する。片方だけ失敗しても、もう片方の報告は残る。

| 終了コード | 意味 |
|------------|------|
| 0 | 問題なし |
| 1 | 1 件以上 |

範囲：`src/**`、ルートの `*.json`、サイドカー（`script/`、`test/` …）。`node_modules`、`dist`、`.v23` は除外。

## 成果物（`<ベース>/.v23/`）

| ファイル | 役割 |
|----------|------|
| `syntax-issues.json` | 機械可読の結果 |
| `syntax-issues-for-ai.md` | AI 向けのパス:行リスト |

## `syntax-issues.json`

成功：

```json
{
  "ok": true,
  "projectRoot": "D:/.../app",
  "total": 0,
  "issues": []
}
```

失敗項目：

| フィールド | 意味 |
|------------|------|
| `file` | プロジェクトルート相対パス |
| `line` / `column` | 1 始まり |
| `kind` | `json`、`json-duplicate-key`、`binding`、`syntax`、`vue-sfc` |
| `message` | パーサまたは JSON のメッセージ |

## AI の手順

1. `syntax-issues-for-ai.md` を開く。
2. 移行後ファイルを直す（壊れた JSON、不正な宣言、切れた script）。
3. 移行器が壊れた構文を出したなら `2to3` を直し、パイプラインを再実行する。`1.pure-vue-app`、`2.pure-vue-app`、`my-vue-app` はそのまま。
4. `v23-check-syntax` を `ok: true` になるまで再実行する。

移行作業では `docs/en/syntax-check-format.md` を正とする。

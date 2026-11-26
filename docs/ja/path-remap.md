# パス再マップ（AI レイアウト差分）

Vue3 ベースがディレクトリを**改名・移動**し、ingest 済みソースが旧パスのまま import
している場合（例: `util` → `utils`、`@/axios` → `@/api/axios`）、スクリプトは対応表を推測できない。
**AI** が一時的な対照表を書き、**範囲限定**スクリプトが今回取り込まれたファイルだけを直す。

## 成果物（`<to>/.v23/`）

| ファイル | 誰 | 役割 |
|----------|----|------|
| `path-remap.md` | AI | ソース ↔ ベース対照表（一時） |
| `path-remap.json` | AI | スクリプト用マッピング |
| `ingest-files.txt` | スクリプト copy | **範囲リスト** — これ以外は触らない |
| `path-remap-report.json` | スクリプト | 適用結果 |

copy 時に stub が無ければ空の `path-remap.md` / `path-remap.json` を作る（既存は上書きしない）。

## `path-remap.json` 形式

```json
{
  "version": 1,
  "generatedBy": "ai",
  "notes": "ベースで util→utils、axios を api/ へ",
  "mappings": [
    { "from": "@/util/", "to": "@/utils/" },
    { "from": "@/util", "to": "@/utils" },
    { "from": "@/axios", "to": "@/api/axios", "kind": "exact" }
  ]
}
```

| フィールド | 意味 |
|------------|------|
| `from` / `to` | `import` / `require` / `import()` の文字列（接頭辞または完全一致） |
| `kind` | 省略または `"prefix"`（既定）: 完全一致 **または** `from/` + 残り。`"exact"`: 完全一致のみ |

長い `from` が優先。ディレクトリ改名時は `@/util/` と `@/util` の両方を推奨。

## コマンド

```bash
node 2to3/bin/migrate.js --to <ベースルート> --step path-remap
node 2to3/bin/apply-path-remap.js <ベースルート>
node 2to3/bin/apply-path-remap.js <ベースルート> --dry-run
node 2to3/bin/apply-path-remap.js <ベースルート> --stub
```

## 範囲の硬規則

- `ingest-files.txt`（または `--files-from`）のパス**だけ**。
- ツリー全体は走査しない — AI が作ったベースファイルは変更しない。
- ingest リストが空／無し → **実行拒否**。
- `mappings` 空 → 成功としてスキップ。

## AI チェックリスト

1. ソースとベースのレイアウト差を洗い出す。
2. `path-remap.md` と `path-remap.json` を同じ内容で埋める。
3. `--step path-remap` を実行。
4. `--step check`。旧接頭辞が残るならマッピングを足して再実行。

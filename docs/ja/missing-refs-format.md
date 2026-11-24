# 欠落参照検出：ファイル形式と役割（AI 向け）

## 役割

移行の**全機能完了後**に必要な仕上げとして、ベース工程内のローカル `import` / `require` / `import()` / `export from` などのパスが実在ファイルを指しているか検査します。

- **スクリプト位置（本リポジトリ。ユーザーのグローバル skill は使わない）**：`2to3/scripts/check-import-refs.mjs`
- **入口ラッパー**：`2to3/bin/check-refs.js`（`v23-check-refs`）
- **欠落があるとき**：結果を AI に渡し、「ファイル補完 / 参照修正 / 誤検知として無視」を確認してもらう

エイリアス解決は、検査対象プロジェクトから上方向に見つかる `jsconfig` / `tsconfig` / `webpack.config.*` / `vite.config.*` などから取得します（`@`、`~` など）。

---

## 実行方法

```bash
node 2to3/bin/check-refs.js <ベースルート>
node 2to3/bin/check-refs.js <ベースルート> --all
node 2to3/bin/check-refs.js <ベースルート> --files-from <一覧.txt>
```

下層の等価コマンド：

```bash
node 2to3/scripts/check-import-refs.mjs <ベースルート> --json [--files-from list.txt]
```

| 終了コード | 意味 |
|------------|------|
| 0 | 通過（欠落なし） |
| 1 | 欠落あり、または未通過 |
| 2 | ラッパースクリプトが検出器を見つけられないなどの設定エラー |

---

## 成果物（いずれも `<ベース>/.v23/` 配下）

| ファイル | 役割 |
|----------|------|
| `missing-refs.json` | 正規化後の完全結果。プログラム/AI はこれを優先して読む |
| `missing-refs-for-ai.md` | 人/AI 向けのパス:行番号リスト |
| `missing-refs.raw.txt` | 下層スクリプトの生 stdout/stderr |
| `ingest-files.txt` | ingest が書いた「今回取り込まれたファイル」一覧（デフォルト検査範囲） |
| `all-src-files.txt` | `--all` 時に生成される全 src 一覧 |

---

## `missing-refs.json` 形式

### 通過時

```json
{
  "ok": true,
  "projectRoot": "D:/.../migrate-base",
  "totalMissing": 0,
  "missing": [],
  "checkedAt": "ISO-8601",
  "checker": ".../2to3/scripts/check-import-refs.mjs"
}
```

### 未通過時

```json
{
  "ok": false,
  "projectRoot": "D:/.../migrate-base",
  "totalMissing": 2,
  "missing": [
    {
      "file": "src/views/Foo.vue",
      "line": 12,
      "specifier": "@/components/Bar.vue",
      "missing": "src/components/Bar.vue",
      "project": ".",
      "raw": { }
    }
  ],
  "raw": { },
  "hint": "请 AI 逐条确认：补文件 / 改 import / 或忽略误报",
  "formatDoc": "2to3/docs/missing-refs-format.md",
  "checker": ".../check-import-refs.mjs",
  "checkerExit": 1
}
```

### `missing[]` フィールド（ラッパー後は英語キーで統一）

| フィールド | 型 | 意味 |
|------------|----|------|
| `file` | string | **参照元**ファイル（プロジェクトルート相対）。AI はこのファイルを開く |
| `line` | number\|null | 問題の行番号 |
| `specifier` | string | ソース上のインポート文字列。例：`@/utils/x`、`./Child.vue` |
| `missing` | string | 解決後に存在するはずだがディスク上にないパス |
| `project` | string\|null | 解決時にアンカーしたサブプロジェクト識別子（モノレポで有用） |
| `raw` | object | 下層の生エントリ（中国語キーを含む場合あり） |

### 下層スクリプトの生失敗 JSON（`raw` / `missing-refs.raw.txt`）

下層が `--json` かつ失敗時、stdout は次の形になります：

```json
{
  "ok": false,
  "missing": [
    {
      "引用文件": "src/views/Foo.vue",
      "行号": 12,
      "导入语句": "@/components/Bar.vue",
      "缺失路径": "src/components/Bar.vue",
      "项目": "."
    }
  ],
  "aliases": { "@": "src", "~": "src" },
  "projectAliases": { },
  "checkedFiles": ["src/views/Foo.vue"]
}
```

中国語キーと英語キーの対応：

| 中国語キー | 英語キー |
|------------|----------|
| 引用文件 | file |
| 行号 | line |
| 导入语句 | specifier |
| 缺失路径 | missing |
| 项目 | project |

成功かつ `--json` のとき、下層はさらに `ok`、`aliases`、`checkedFiles` などを付けます。

---

## `missing-refs-for-ai.md` 形式

```markdown
# 缺失引用（请 AI 确认）

- 项目: `...`
- 共 N 条

1. `src/views/Foo.vue:12`
   - 导入: `@/components/Bar.vue`
   - 缺失路径: `src/components/Bar.vue`
```

AI 処理の取り決め：

1. `` `file:line` `` でファイルを開く。
2. `导入`（specifier）の誤りか、対象ファイルが ingest されていないかを確認する。
3. ファイル補完 / パス修正 / 無視可能と明示したあと、`v23-check-refs` を `ok: true` になるまで再実行する。

---

## 能力の境界

- **カバー**：ローカル相対パス、プロジェクト alias；拡張子省略と `index`。
- **スキップ**：npm パッケージ名、URL、`node:` など。
- **保証しない**：純粋な動的連結パス、実行時にしか決まらないモジュール名。

# 2to3 迁移工作流（脚本 + AI）

## 输入

| 参数 | 含义 | 例 |
|------|------|----|
| `--from` | 被迁移的源项目根 | `D:/old-app` |
| `--src` | 源内目录（相对 from） | `src` |
| `--to` | 迁移到的目标根（底座） | `D:/new-app` |
| `--dest-src` | 目标内目录（默认=src） | `src` |

## 阶段顺序

```
1. analyze     脚本：分析源项目（图 / 风险线索）
2. scaffold    AI：建好 Vue3 底座（**优先 Vite**；见 docs/ai-scaffold-notes.md；--scaffold 仅旧模板兜底）
3. copy        脚本：from/src → to/src；并拷根级旁路目录（script/test/style/mock…）
               · 目标已有同名文件 → 先备份到 to/.v23/backup/<时间戳>/ 再覆盖
               · 顺带按底座 alias 改写 import
4. pipeline    脚本：自动能改的先改（sync/native/slot/render/mount/…）
               · 不能稳改的打「迁移脚本注释: AI-TODO」
5. 【暂停】    AI：按 to/.v23/ai-todos.md 逐项改
6. check       脚本：v23-check-refs（缺本地引用）
7. 下一轮      通过后可再 pipeline / build 验收
```

## 命令

```bash
# 一次跑到「AI 交接」（默认）
node 2to3/bin/migrate.js --from D:/old-app --src src --to D:/new-app

# 目标还没有底座时，让脚本先拷模板
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --scaffold --step all

# 只分析源
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --step analyze

# AI 改完 AI-TODO 后
node 2to3/bin/migrate.js --to D:/new-app --step check

# 再跑一轮脚本迁移
node 2to3/bin/migrate.js --to D:/new-app --step pipeline
```

## 分工

| 谁 | 做什么 |
|----|--------|
| 脚本 | 分析、copy+备份、确定性语法迁移、打 AI-TODO、缺引用检查 |
| AI | 建底座（优先 Vite、复刻工程配置、处理 CDN）、处理 AI-TODO、确认缺引用、业务语义决策 |

## 关键产物（均在 `<to>/.v23/`）

| 文件 | 作用 |
|------|------|
| `migrate-state.json` | 当前步骤状态 |
| `migrate-copy.json` | 本次 copy 清单与备份 |
| `backup/<时间戳>/` | 被覆盖前的旧文件 |
| `ai-todos.md` | AI 待改清单 |
| `risks.json` / `html-risks.json` | 风险明细 |
| `missing-refs-for-ai.md` | 缺引用确认清单 |

## AI 必读

- `docs/ai-scaffold-notes.md` — **初始化底座注意事项（优先 Vite、style 误报等）**
- `docs/html-format.md` — HTML/template findings
- `docs/streams-handoff.md` — HTML/JS 分流与 `.v23/handoff.json`
- `docs/missing-refs-format.md` — 缺引用 JSON
- `docs/cannot-fully-auto.md` — 不可完整自动项

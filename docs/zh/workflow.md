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
2. scaffold    **AI**：建好 **Vue3** 底座（**Vite**；配置齐全 + 依赖装齐 + **能启动** + **与脚本无缝衔接**；见 ./ai-scaffold-notes.md）
               · 禁止用脚本 `--scaffold` 当正式底座；**脚本不改 `.env*` / VUE_APP↔VITE**
3. copy        脚本：from/src to to/src；并拷根级旁路目录（script/test/style/mock…）
               · 目标已有同名文件 to 先备份到 to/.v23/backup/<时间戳>/ 再覆盖
               · 按底座 alias 改写 import（工程配置与 env 已由 AI 准备）
4. pipeline    脚本：确定性语法迁移（sync/native/slot/render/mount/Element UI→Plus/…）
               · Element：size / type=text / underline / 日期 format / dialog v-model / 包路径；图标与 Vue.use 仍 AI-TODO
               · 不能稳改的打 AI-TODO；**不迁移环境变量/工程配置**
5. 【暂停】    AI：改 ai-todos.md；若底座改了目录名（util→utils、axios 路径等），填 path-remap.md + path-remap.json
               再 `--step path-remap`（只动迁入文件 — 见 path-remap.md）
6. check       脚本：v23-check-refs（缺本地引用）+ v23-check-syntax（JSON / JS / Vue script 语法）
7. 下一轮      通过后可再 pipeline / path-remap / build 验收
```

## 命令

```bash
# 先由 AI 建好 Vue3 底座（配置齐全 + 依赖装好 + 能启动），再跑脚本
node 2to3/bin/migrate.js --from D:/old-app --src src --to D:/new-app

# 只分析源
node 2to3/bin/migrate.js --from D:/old-app --to D:/new-app --step analyze

# AI 填完 .v23/path-remap.json（布局差异）后
node 2to3/bin/migrate.js --to D:/new-app --step path-remap

# AI 改完 AI-TODO 后
node 2to3/bin/migrate.js --to D:/new-app --step check

# 再跑一轮脚本迁移
node 2to3/bin/migrate.js --to D:/new-app --step pipeline
```

## 仓库夹具（源）

| 路径 | 作用 |
|------|------|
| `2.pure-vue-app` | Options→Composition + vue-router 夹具（`--from`） |
| `1.pure-vue-app` | 仅旧模板兜底；不作正式 Vue3 底座 |
| `my-vue-app` | 混合 Vue2 夹具（禁止删文件） |
| `element-ui-docs` | ElemeFE/element **官方文档站**完整克隆（可点开全部官方 demo）。本地说明见 `element-ui-docs/README.local.md`（需 Node **16**、dart-sass 补丁）。非标准可迁工程布局——用于 UI 覆盖测试，勿作 `--to`。 |
| `element-ui-demo` | 可选：Vue2 + element-ui、`@`/`src` + 迁移探测页（若存在）作 `--from`。**`--to` 仍须 AI 建 Vite + Vue3 + Element Plus**。 |

示例（存在 `element-ui-demo` 时）：

```bash
node 2to3/bin/migrate.js --from element-ui-demo --src src --to output/element-ui-demo-migrate
```

## 分工

| 谁 | 做什么 |
|----|--------|
| 脚本 | 分析、copy+备份、确定性语法迁移、打 AI-TODO、缺引用检查、语法检查；**不碰 `.env*` / 工程配置**。分析只写 `<from>/.v23` 报告——**不改写源文件**，除非 `v23-run` / `v23-pipeline` 显式带 `--write`（迁移写的是 `--to`） |
| AI | 建 **Vue3** 底座（Vite；**全部工程配置**、**装依赖**、**能启动**、**与脚本无缝衔接**）、处理 AI-TODO、确认缺引用、业务语义决策 |

## 关键产物（均在 `<to>/.v23/`）

| 文件 | 作用 |
|------|------|
| `migrate-state.json` | 当前步骤状态 |
| `migrate-copy.json` | 本次 copy 清单与备份 |
| `backup/<时间戳>/` | 被覆盖前的旧文件 |
| `ai-todos.md` | AI 待改清单 |
| `risks.json` / `html-risks.json` | 风险明细 |
| `missing-refs-for-ai.md` | 缺引用确认清单 |
| `syntax-issues.json` / `syntax-issues-for-ai.md` | JSON 与脚本语法问题 |
| `path-remap.md` / `path-remap.json` | AI 布局差异；`--step path-remap` 只作用于 `ingest-files.txt` |
| `ingest-files.txt` | 本轮 copy 写入的文件（check-refs / path-remap 范围） |

## AI 必读

**AI 只看英文版**（`../en/`）。下列为中文对照；执行迁移时打开 `docs/en/` 同名文件。

- `../en/ai-scaffold-notes.md` — 初始化底座注意事项（优先 Vite、style 误报等）
- `../en/html-format.md` — HTML/template findings
- `../en/streams-handoff.md` — HTML/JS 分流与 `.v23/handoff.json`
- `../en/missing-refs-format.md` — 缺引用 JSON
- `../en/syntax-check-format.md` — JSON / 声明 / 脚本语法检查
- `../en/cannot-fully-auto.md` — 不可完整自动项
- `../en/path-remap.md` — 路径布局差异与限定范围的 import 重写

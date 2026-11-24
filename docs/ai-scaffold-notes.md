# AI 初始化底座：注意事项

迁移第 2 步由 **AI 创建目标工程底座**（`--to`）。脚本 `--scaffold` 只是拷贝仓库内旧模板，**正式迁移请优先让 AI 按下列要求新建**。

## 构建工具：优先 Vite

- **默认用 Vite + Vue 3** 建底座（`create-vue` / 手写 `vite.config` 均可）。
- **不要默认再用 webpack / vue-cli**，除非用户明确要求，或源项目强依赖短期只能在 webpack 预览。
- 推荐依赖方向：`vue@3`、`vue-router@4`、按需 `pinia` 或 `vuex@4`、UI 按源项目选型（如 Element Plus）。
- 入口：`index.html` + `src/main.js`（或 `.ts`），`resolve.alias['@'] → src`。

## 复刻源项目「全部工程配置」

建底座时，AI 必须对照 **迁移源（`--from`）** 把工程级配置迁到 / 复刻进底座，不能只起一个空 Vite 壳。

### 必扫并处理的配置面

| 来源（示例） | 底座侧动作 |
|--------------|------------|
| `package.json` dependencies / scripts | 升到 Vue3 生态等价包，保留业务脚本意图（build/lint/analyz 等） |
| `vue.config.js` / `webpack.config.*` | 转成 `vite.config`：alias、proxy、publicPath、define、静态目录、压缩等 |
| `.env*` / `process.env.VUE_APP_*` | 改为 `VITE_*` + `import.meta.env`（或兼容层），变量名清单对齐 |
| `babel.config.*` / `.browserslistrc` | Vite 下多为默认；特殊 polyfill/插件要记入底座或 AI-TODO |
| `postcss` / `sass` / `less` 配置 | 在 Vite 中复现同名能力 |
| `eslint` / `prettier` / `editorconfig` | 拷到底座并按 Vue3 语法调整 |
| `jsconfig` / `tsconfig` paths | 与 Vite alias 一致 |
| `public/` 静态资源、favicon、未打包 html | 拷到底座 `public/` |
| `index.html` 里的 meta / 标题 / 注入 | 写入 Vite 根 `index.html` |
| 路径别名、CDN externals、gzip、分析插件 | 在 Vite 用 `build.rollupOptions` / 插件等价实现 |

原则：

- **语义对齐**：源里「起过作用」的配置，底座要有对应项或明确的「已弃用/不需要」说明（可写在 `to/.v23/scaffold-notes.md`）。
- **版本升级**：配置复刻不等于原样粘贴 Vue2 工具链；目标是 **Vue3 + Vite 下行为等价**。
- 业务页面仍由脚本 `copy` 灌入；AI 负责 **工程壳 + 配置 + 依赖选型**。

## CDN 处理

先判断资源是不是「项目自己的包 / Vue 技术栈依赖」，再决定是否管 CDN。

### 可以不管（跳过）

同时满足或明显属于下列情况时，**不必**把 CDN 改成 npm 依赖：

1. **纯 HTML / 纯 JS 碎片**：未使用 Vue、Element、Vue Router、Vuex（页面无 `new Vue`、无 `Vue.use`、无对应全局变量参与业务框架）；或  
2. **独立第三方小工具**：有自己的用法、与业务框架无关（统计、地图 SDK 演示页、单页小脚本等），且源项目也未在 `package.json` 里依赖同名包。

这类可保留 `<script src="https://...">` / 外链 CSS，只保证 `index.html` / 静态页拷到了底座。

### 必须处理

出现以下任一情况，CDN **不能当摆设忽略**：

| 情况 | 做法 |
|------|------|
| CDN 提供的是 **Vue / vue-router / vuex / Element**（或其它已在 `package.json` 声明的栈） | 底座改为 **npm 依赖 + import**；去掉（或条件化）CDN，避免双份运行时 |
| `webpack externals` / `vue.config` 里把上述库外置到 CDN | Vite 下改为正常打包，或显式 `rollupOptions.external` + `index.html` 注入，并写清全局名映射 |
| 业务代码假设全局 `Vue` / `ELEMENT` / `VueRouter` / `Vuex` | 改为模块 import；若短期保留 CDN，须在底座文档标明全局名与加载顺序 |
| 同一库既 CDN 又 `package.json` | **以 package 为准**，删掉重复 CDN，防止双 Vue 实例 |

### 判断流程（给 AI）

```
读 index.html / 入口 html / 构建 externals
  ├─ 引用的是 vue / router / vuex / element（或 package 里已有的库）？
  │     → 必须处理：npm 化或显式 external，禁止静默保留双份
  └─ 纯工具 CDN，且工程未用 Vue 栈加载它？
        → 可不管：原样拷到 public / html
```

不确定时：记入 `ai-todos.md` / `scaffold-notes.md`，标 `CDN`，不要默默丢掉。

## 根级独立目录（`script/` / `test/` / `style/` …）

很多老项目在 **`src` 之外**还有旁路目录，例如：

`script/`、`scripts/`、`test/`、`tests/`、`style/`、`styles/`、`mock/`、`docs/`、`static/`、`vendor/`、`cdn/`、根级 `assets/` 等。

### 绝不迁移（硬排除）

以下**不要**当旁路拷贝/扫描（即使源根存在）：

`node_modules/`、`dist/`、`build/`、`coverage/`、`.git/`、`.v23/`、以及常见构建缓存目录。

底座自己 `npm install`；产物由底座重新 build。AI 建底座时也不要去拷这些。

### 脚本侧（已支持）

- **copy**：`v23-migrate` 在拷 `src` 之后，会把源根下实际存在的上述旁路目录 **整目录拷到 `--to` 同名路径**（覆盖前备份）；`node_modules`/`dist` 等在白名单外且有硬排除。
- **pipeline / analyze**：默认 `include` 已覆盖这些目录下的 js/ts/vue/css/html；无 Vue 栈语法时插件通常自然 skip。

### AI 侧怎么判

| 情况 | 处理 |
|------|------|
| 目录存在 | 必须进底座（不要只迁 `src` 就当完事） |
| 纯 HTML/JS、**未**使用 Vue / Element / Router / Vuex | **可不管改写**：原样保留即可（同 CDN「可不管」） |
| 含 `new Vue` / `from 'vue'` / element / router / vuex | 走流水线迁移；跑不通的打 AI-TODO |
| 测试跑法则依赖 Jest/Karma 等 | 复刻对应配置到 Vite/Vitest（或记 scaffold-notes） |

判断口诀：先保证 **拷过去**，再按是否 Vue 栈决定 **改不改**。

## 底座最小结构

```
<to>/
  package.json              # 依赖对齐源项目升级后的栈
  vite.config.js
  index.html                # 含需保留的非框架 CDN（若有）
  .env* / .editorconfig / eslint 等（从源复刻）
  public/
  src/
    main.js
    App.vue
    router/                 # 可先空壳，copy 后再接
  .v23/scaffold-notes.md    # 可选：配置/CDN 决策说明
  .gitignore
```

- `npm install` 能起来；`npm run dev` 能打开空白壳即可。
- **不要**在底座里预塞业务页面；业务由脚本 `copy/ingest` 从 `--from` 灌入。

## 已知坑（建底座 / 预览时）

### 1. 多 `<style>` 与 vue-loader@15（仅 webpack 路径）

若临时用 **webpack + vue-loader@15**（Vue2 试验预览）：

- 同一 `.vue` 多个 `<style>` 时，常出现误报：
  `export 'default' (imported as 'style0'|'style1'|…) was not found`
- **不是迁移把 CSS 写坏了**；样式一般已注入/抽取，可忽略。
- webpack 配置建议：

```js
ignoreWarnings: [
  { message: /export 'default' \(imported as 'style\d+'\) was not found/ },
]
```

- **Vite 底座无此问题**，故正式 Vue3 底座优先 Vite。

### 2. Vue2 预览 vs Vue3 底座

- `my-vue-app` / HTML 预览流可能仍是 Vue2 + webpack，仅用于验收模板改写。
- **迁移目标 `--to` 应为 Vue3 + Vite**；不要把 Vue2 试验工程当成最终底座。

### 3. 源工程保护

- 对用户标明「勿删」的源目录（如 `my-vue-app`）：只增改，不删、不用 `/MIR` 清空。
- 迁移输出写到独立 `--to` / `output/...`，与源分离。

### 4. HTML / JS 分流

- 先 HTML 流再 JS 流时，看 `<to>/.v23/handoff.json`。
- 模板 `|filter`→函数调用后，须有 JS 流 `migrate-filters`（或 handoff 消费）；找不到则 skip。

## AI 自检清单

建完底座后确认：

1. [ ] 使用 **Vite**（除非用户另有要求）
2. [ ] 源项目 **工程配置已复刻/等价迁移**（env、alias、proxy、lint、public、脚本等）
3. [ ] **CDN**：框架类已 npm 化或显式 external；纯 HTML/JS 无关 CDN 可保留
4. [ ] 根级 **`script/` / `test/` 等旁路目录**已拷入底座；非 Vue 栈可不改写
5. [ ] `npm run dev` 可启动
6. [ ] `@` → `src` alias 已配
7. [ ] 未误删源项目文件
8. [ ] 未把 webpack 多 style 误报当成迁移失败
9. [ ] （建议）写下 `.v23/scaffold-notes.md` 记录配置、CDN、旁路目录决策

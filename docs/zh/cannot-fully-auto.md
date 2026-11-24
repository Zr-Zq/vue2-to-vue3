# 无法完整自动处理清单（需人工 / AI 方案）

前置风险流水线可以**检出并登记**下列项，并默认**不改逻辑**，只在源码插入：

`/* migrate-script note: AI-TODO [category] … */`  
（模板内为 `<!-- migrate-script note: AI-TODO … -->`）

旧版中文标记（仍可识别）：`迁移脚本注释: AI-TODO`。

由 AI 按注释逐项处理；脚本侧不做语义改写。

**不在本清单、也不由脚本迁移：** `.env*` / `VUE_APP_*`↔`VITE_*` / `process.env`↔`import.meta.env` 及工程配置——一律在 **AI 建 Vue3 底座**时处理（见 `ai-scaffold-notes.md`）。

**已可脚本确定、不再当危险（不入本清单、不打 AI-TODO）：**

- `.sync` → `v-model:`、`.native` 去掉、旧 slot → `v-slot`
- `keep-alive` + `:is` → 补 `:key`
- 实例 `$on` / `$off` / `$once` → `this.$bus.*`，并拷贝/注册 `src/compat/v23-bus.js`
- `render(h)` → 去 h 参 / 拍平 data / `$scopedSlots→$slots`
- `Vue.extend` → `defineComponent`；`$mount` → `createApp().mount`
- `$children` → `__v23Children(this)` 近似
- 生命周期 `beforeDestroy`/`destroyed` → `beforeUnmount`/`unmounted`
- `this.$set`/`Vue.set` → 赋值；`$delete`/`Vue.delete` → `delete`
- `$listeners` → `$attrs`；模板 `v-on="$listeners"` → `v-bind="$attrs"`
- 自定义指令钩子名映射（`bind`→`beforeMount` 等）
- 模板 `|` 过滤器 → 函数调用（HTML 流）；`filters`→`methods`（JS 流，经 `.v23/handoff.json` 交接，找不到则 skip）
- `>>>` `/deep/` `::v-deep` → `:deep()`
- 删除 `Vue.config.productionTip` / `silent` 赋值
- `<template functional>` / `functional: true` → 普通组件（`$props`/`$attrs`，去 `listeners`）

---

1. **同节点 `v-for` + `v-if`** (`v-for-v-if`)  
   **仅当两者在同一元素上**——交给 AI（常见 Vue3：`<template v-for :key>` + 内层 `v-if`）。  
   **不在同一标签上**：无需处理（不登记）。

2. **`$parent` / `$root` 等实例树 API** (`instance-api`)  
   依赖运行时组件树。`$children` / `$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` 已脚本处理。

3. **子组件修改 props（间接/别名）** (`props-mutation`)  
   直接赋值可检；解构、别名、透传后再改会漏。

4. **mixin 同名合并优先级 / 全局 mixin 注入** (`mixin-collision`)  
   合并策略与影响面需产品决策，不能盲合并。

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` 全局副作用** (`global-side-effect`)  
   需迁到 app 级 API；`productionTip`/`silent` 已脚本删除。`keyCodes`、`prototype`、`mixin` 仍需人工。

6. **`setup` 与 Options 混用策略** (`setup-mix`)  
   继续混用或全 Composition 是架构选择。

7. **`provide` 原始类型不响应** (`provide-primitive`)  
   包成 `ref` 会改变所有 inject 方取值方式。

---

检出结果见运行后的：

- `<project>/.v23/risks.json`（`--keep` 时保留）
- 仓库 `output/<project>-risks/`（每次跑完会备份）

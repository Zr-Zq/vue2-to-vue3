# 无法完整自动处理清单（需人工 / AI 方案）

前置风险流水线可以**检出并登记**下列项，并默认**不改逻辑**，只在源码插入：

`/* migrate-script note: AI-TODO [category] … */`  
（模板内为 `<!-- migrate-script note: AI-TODO … -->`）

旧版中文标记（仍可识别）：`迁移脚本注释: AI-TODO`。

由 AI 按注释逐项处理；脚本侧不做语义改写。

**不在本清单、也不由脚本迁移：** `.env*` / `VUE_APP_*`↔`VITE_*` / `process.env`↔`import.meta.env` 及工程配置——一律在 **AI 建 Vue3 底座**时处理（见 `ai-scaffold-notes.md`）。

**已可脚本确定、不再当危险（不入本清单、不打 AI-TODO）：**

- `.sync` to `v-model:`、`.native` 去掉、旧 slot to `v-slot`
- `keep-alive` + `:is` to 补 `:key`
- 实例 `$on` / `$off` / `$once` to `this.$bus.*`，并拷贝/注册 `src/compat/v23-bus.js`
- `render(h)` to 去 h 参 / 拍平 data / `$scopedSlotsto$slots`
- `Vue.extend` / `Sub.extend` to 可 `new` 的 `__v23Extend`（`src/compat/v23-extend.js`）：仍是函数，动态 `new variable()` 和 `typeof Ctor === 'function'` 保持原意。直接或别名调用（`new SomeExtend()` / `const Ctor = SomeExtend; new Ctor()`，同文件或 import）to `__v23New(Ctor, extra)`。`$mount` to `createApp().mount`
- Optionsto**`<script setup>`**（不用 `defineComponent`）：`data`to`ref`、`computed`（get/set）、`watch`、`provide`/`inject`、`filters`tomethods、生命周期to`onXxx`（`beforeCreate` + `created` 依次内联）、`defineProps`/`defineEmits`/`defineOptions`、指令to`vName`、去 `this`+`.value`、同名别名、官方 `$`、mixin 展平、bind/call 与 `this._*` 分析；插件 `migrate-options-composition`。**`options.model`toAI**
- **异步工厂** to `defineAsyncComponent`（`() => import()`、带 `loading`/`error`/`delay` 的对象形、`Vue.component('X', () => import())`）；插件 `migrate-async-component`。Optionstosetup 时也会把本地 `components`（含异步）内联进 `defineOptions.components`
- **TS 只搬运已有类型**（不发明）：已有 `data(): { x: T }` to `ref<T>`；已有 `PropType` / 方法注解随 `defineProps` / 函数保留
- **不属于 options-composition**（`this.$…` 留给专用插件）：`$router`/`$route` to `router`；`$store` / `map*` to `vuex`；`$i18n`/`$t`/`$tc`/… to `i18n`
- 生命周期 `beforeDestroy`/`destroyed` to `beforeUnmount`/`unmounted`
- `this.$set`/`Vue.set` to 赋值；`$delete`/`Vue.delete` to `delete`
- `$listeners` to `$attrs`；模板 `v-on="$listeners"` to `v-bind="$attrs"`
- 自定义指令钩子名映射（`bind`to`beforeMount` 等）
- 模板 `|` 过滤器 to 函数调用（HTML 流）；`filters`to`methods`（JS 流，经 `.v23/handoff.json` 交接，找不到则 skip）
- `>>>` `/deep/` `::v-deep` to `:deep()`
- 删除 `Vue.config.productionTip` / `silent` 赋值
- `<template functional>` / `functional: true` to 普通组件（`$props`/`$attrs`，去 `listeners`）
- **Element UI → Element Plus**（插件 `element`，`mode: migrate`）：`size` `medium`→`default` / `mini`→`small`；`el-button type="text"`→`text`；`el-link :underline`→`always|never`；日期 `format`/`value-format` fecha→dayjs（`yyyy`→`YYYY` 等）；dialog/drawer `custom-class`→`class`；**`el-dialog` / `el-drawer` 的 `:visible.sync` / `v-model:visible`→`v-model`**；`el-submenu`→`el-sub-menu`；静态 `icon`/`prefix-icon`/`suffix-icon`/`<i class="el-icon-*">`→PascalCase（需全局注册 `@element-plus/icons-vue`）；CSS 把 `.el-input__inner` 上的边框/背景/阴影迁到 `.el-input__wrapper` 并去掉 inner 边框；`element-ui` 包/预构建 CSS/locale **lang** 路径→`element-plus`。**仍交 AI：** 动态 `:icon` / 残留 `el-icon-*`、`Vue.use(ElementUI)`→`createApp().use(ElementPlus)`、SCSS `theme-chalk` / `$--color-*` 重建、`Locale.use`→`el-config-provider :locale`（不要盲改 `lib/locale` 根或 `packages/theme-chalk`）
- **底座布局路径改名**（`util`→`utils`、axios 挪到 `@/api/…`）：AI 填 `.v23/path-remap.md` + `path-remap.json`；脚本 `v23-apply-path-remap` / `--step path-remap` **只**改 `ingest-files.txt` 里的文件（见 `path-remap.md`）

---

1. **同节点 `v-for` + `v-if`** (`v-for-v-if`)  
   **仅当两者在同一元素上**——交给 AI（常见 Vue3：`<template v-for :key>` + 内层 `v-if`）。  
   **不在同一标签上**：无需处理（不登记）。

2. **`$parent` / `$children` / `$root` 等实例树 API** (`instance-api`)  
   `$parent` / `$root` 经 setup 捕获的 proxy 桥接。**`$children`**：模板里有组件 `ref=` 时，脚本改成 `[ref.value, …].filter(Boolean)`；否则 **归 AI**（打 AI-TODO）。`$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` 已脚本处理。

3. **子组件修改 props（间接/别名）** (`props-mutation`)  
   直接赋值可检；解构、别名、透传后再改会漏。

4. **mixin 同名合并优先级 / 全局 mixin 注入** (`mixin-collision`)  
   合并策略与影响面需产品决策，不能盲合并。

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` 全局副作用** (`global-side-effect`)  
   需迁到 app 级 API；`productionTip`/`silent` 已脚本删除。`keyCodes`、`prototype`、`mixin` 仍需人工。

   **AI 抽验（命中多时最多抽 5 个）：** 确认已迁到 `createApp()` 侧，且调用方仍可用：

   | # | Vue2 | Vue3 落点 | AI 核对 |
   |---|------|-----------|---------|
   | 1 | `Vue.mixin({…})` | `app.mixin({…})` | 与局部 mixin 的合并顺序 / 同名冲突 |
   | 2 | `Vue.prototype.$foo = …` | `app.config.globalProperties.$foo` | `this.$foo` 调用点（及类型声明） |
   | 3 | `Vue.config.errorHandler` | `app.config.errorHandler` | 仍能收到 err / instance / info |
   | 4 | `Vue.config.warnHandler` | `app.config.warnHandler` | 开发期警告仍路由到此 |
   | 5 | `Vue.config.keyCodes` / `ignoredElements` | 去掉 `keyCodes`；自定义标签用 `app.config.compilerOptions.isCustomElement` | `.keyXxx` 修饰符 / Web Component 不静默坏掉 |

   若 `risks.json` 里 `global-side-effect` 超过 5 条，优先覆盖 **mixin / prototype / errorHandler / warnHandler / keyCodes|ignoredElements**（缺啥用现有最接近的凑满 5）；其余保持 AI-TODO 下一轮再清。

   **旁路目录里的非 SFC Options 对象：** 根级 `script/`、`mock/`、`lib/` 等（见 `sidecar-dirs.js`）里可能有裸 `export default { data(){}, methods:{} }`，**不是** `.vue`。copy+流水线可能按 script-setup 风格改写，但 `defineProps`/`defineEmits` 是 SFC 宏——真组件应迁进 `.vue`。

6. **`setup` 与 Options 混用策略** (`setup-mix`)  
   继续混用或全 Composition 是架构选择。

7. **`provide` 原始类型** (`provide-primitive`)  
   OptionstoComposition 时脚本把原始值包成 `ref`，并打 AI-TODO 提醒 inject 侧（auto=`partial`）。  
   **范围：** `provide` / `provide()` 返回对象里的字面量 string/number/boolean/null。  
   **AI：** 原先当原始值用的 inject 调用点需改为 Ref（`.value`）或改设计。

8. **Options to Composition 剩余项** (`options-to-composition`)  
   **保留 Options API（不转换）：** 含 **import 的** mixin 或 **`options.extends`** 的组件——脚本无法在单文件内展平，而 Vue3 仍支持 `mixins`/`extends`；只加 AI-TODO `kept Options API (…)`，并列出仍在使用、需 AI 改写的 Vue2 专有实例 API（`$createElement`、`$vnode`、`$destroy`、`$children`、`_uid` …）。  
   仍归 AI（收尾）：**`options.model`**、上述保留 Options 的组件（维持 Options 或改成 composable）、**`$children`**（模板没有可映射的组件 ref 时）、子组件 **`$destroy`**、裸读 **`this.$options.methods` 整袋**（`this.$options.methods.foo` 已改成本地函数）、普通 `.js`/`.ts` Options to 需要宏时再迁入 `.vue`。收尾完成后**删掉 AI-TODO 字样**。  
   **现已确定路径：** `this.$el` / 裸 `$refs` / `$parent` / `$root` / `$options` / `$forceUpdate` to `__v23Proxy?.…`，`$vnode` / `$destroy` to `__v23Proxy?.$.…`（proxy 在 setup 中捕获，方法里调用也安全）；`$ssrContext` to setup 中捕获的 `useSSRContext()`（仅 SSR 构建）；`data()` prelude/简写/`this.prop` to IIFE/`props.*`；本地 `components` 内联进 `defineOptions.components`（字符串 `:is`）；`defineExpose` 供父级 `$refs`。  
   **data 的 `this._xxx`：** 若 `_xxx` 是 `data()` 字段，脚本按普通 data 改写成 ref（+ AI-TODO：Vue2 不会把下划线字段代理到实例）。非 data 的自定义字段（如 `this._timer = …`）to 组件实例内的普通对象 `__v23Self._xxx`（非响应式，与 Vue2 一致）。Vue 内部 `_uid` 等仍保留 `this._*`。

**相关确定路径边缘（有单测；不算「风险项」但有范围）：**

| 主题 | 脚本行为 | 不在范围内 |
|------|----------|------------|
| `$mount` + `router`/`store` | 简写与 `router: x` 都抽到 `.use(…)`（含 `{` 后第一个 key） | pinia / i18n / 自定义插件 |
| `Vue.extend` / `Ctor.extend` | `__v23Extend`（函数），并把 `new` 调用点（含别名、import）改成 `__v23New`。`new Ctor()` 走 `createApp` 挂载；当组件用时渲染有状态定义。`extends` 会解开基类包装 | `new Ctor({ data, store, router })` 里除 `propsData` / `el` 以外的字段；既不是 import 也不是本地绑定的自由全局 `new` |
| 同文件嵌套 `mixins: [mid]` | 递归 `mid.mixins` to mid to host | `import` 的 mixin 模块（组件保留 Options API） |
| import 的 mixin / `extends` | 保留 Options API + AI-TODO（不转 `<script setup>`） | 自动抽 composable |
| 普通 `.js`/`.ts` Options / mixin | 检出 + AI-TODO；**保留** `export default` | 在 `.vue` 外自动改成 `<script setup>` |
| `data()` 简写 / `this.prop` 初值 | IIFE 或 `props.*`（避免 TDZ） | data() 内非 prop 的 `this` 读 |
| components + 字符串 `:is` | 工厂内联进 `defineOptions({ components })`（它会被提到 setup 外，不能引用 script setup 局部变量）；引用模块局部变量的工厂 to 仅声明 `const`（供标签使用） | 改写模板里的 `:is` 字符串 |
| `data()` 字段与 import 同名 | 内部 ref 改名；不再生成重复声明 import 的别名 | — |
| 父级 `$refs` 调子方法 | `defineExpose` methods/data/computed | 选择性 expose 策略 |
| `filters` 与 `methods` 同名 | 保留 method；filter 并入为 `__v23Filter_<name>`；改写 mustache / `v-bind` 调用（Vue2 filter 只出现在这两处）。事件里仍用 method | 全局 `Vue.filter`；脚本里 `this.$options.filters` |
| 异步 `() => import()` / loading·error·delay 对象 | to `defineAsyncComponent`（含字段映射）；已在 `defineAsyncComponent` 内的 factory 不再二次包裹 | 自定义 Promise loader（非 `import`）；含展开 / 未知字段的选项对象保持原样（不做有损改写）；路由记录的 `component: () => import()` 保持普通 loader |
| Vue Router 3（`router` 插件，默认 `migrate`） | 模块（`.js` **与** `.vue` script）：`createRouter`+history、catch-all、`scrollBehavior` x/y/selector→left/top/el **及**常见断言（`xy-shape`→`lte-shape`、`sample.x\|y\|selector`）、`addRoutes`/`onReady`/`currentRoute.value`（含 `probe.value.currentRoute`）、`match`→`resolve`、`getMatchedComponents()`→`currentRoute.value.matched`；Options→setup 后 `$route`/`$router`→composables，且展开 `const self = this` + `self.foo` | 改守卫时优先 `return` 代替 `next`；**keep-options**；探测用 router 用 `shallowRef`（G013） |
| 拼接 / 模板字符串路径的动态 `import()` | `import('@/views/' + n + '.vue')` to `import.meta.glob('<相对目录>/**/*.vue')` + 按 key 取（缺失时像 webpack 一样 reject） | 无扩展名后缀、裸包前缀、完全动态路径 |
| 源码里已有的 TS 注解 | 搬进 `ref<T>` / `defineProps` / 方法签名 | 无注解时发明泛型或 PropType |
| `ingest` 拷贝 | 同时拷贝样式/资源（scss/css/图片/字体…）；改写 import 时保留 `.vue` 后缀 | env / 工程配置（AI 底座） |

9. **`vue-class-component` / 装饰器** (`typescript-class`)  
   `@Component` / `@Prop` / `@Watch` / `vue-property-decorator` 等：**只检出 + AI-TODO**——脚本**不会**自动改成 Options 或 `<script setup>`。  
   **AI：** 先转 Options，或手迁 Composition；需要时再跑一遍 JS 流。

---

检出结果见运行后的：

- `<project>/.v23/risks.json`（`--keep` 时保留）
- 仓库 `output/<project>-risks/`（每次跑完会备份）

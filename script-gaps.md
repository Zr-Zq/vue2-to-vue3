# 2to3 script gaps & bugs

Single backlog for **uncovered** Vue2 patterns and **script bugs** found while running the migrator.  
Cursor rule: `.cursor/rules/2to3-report-script-gaps.mdc`  
Do **not** “fix” by editing fixture/source apps (`1.pure-vue-app`, `2.pure-vue-app`, `my-vue-app`).

## How to append

| Field | Meaning |
|-------|---------|
| id | `G001`, `G002`, … (monotonic; never reuse) |
| date | `YYYY-MM-DD` |
| kind | `uncovered` = script never handled it; `bug` = claimed/handled wrong |
| area | plugin / transform / bin (e.g. `migrate-extend`, `js-dynamic-import`) |
| symptom | what went wrong in one line |
| repro | path under a project, or a minimal snippet |
| status | `open` / `fixed` / `wontfix` |
| notes | fix commit/path, or pointer into `docs/en/cannot-fully-auto.md` |

## Open

| id | date | kind | area | symptom | repro | status | notes |
|----|------|------|------|---------|-------|--------|-------|
| G001 | 2026-11-25 | uncovered | vuex | plugin is detect-only; `$store` / `map*` not rewritten | any Vuex Options module | open | dedicated migrate still missing |
| G002 | 2026-11-25 | uncovered | i18n | plugin is detect-only; `$t` / `new VueI18n` not rewritten | any vue-i18n setup | open | dedicated migrate still missing |
| G003 | 2026-11-25 | uncovered | migrate-async-component | custom Promise factories (non-`import`) left as-is | `() => new Promise(...)` async component | open | see cannot-fully-auto Async row |
| G004 | 2026-11-25 | uncovered | js-dynamic-import | no file extension / bare package / fully dynamic path left as-is | `import('@/views/' + name)` without `.vue` | open | see cannot-fully-auto Dynamic import row |
| G005 | 2026-11-25 | uncovered | migrate-extend | `new` of a free global (not import / local binding) not rewritten | `new window.SomeCtor()` after Vue.extend assign | open | binding analysis only |
| G006 | 2026-11-25 | uncovered | migrate-mount | pinia / i18n / custom plugins not pulled to `.use()` | `new Vue({ i18n, pinia }).$mount()` | open | only router/store today |
| G011 | 2026-11-25 | bug | migrate-async-component | `() => import()` used as route leaf loader via variable/default arg got `defineAsyncComponent` | `format-routes.js` `leafLoader \|\| () => import(...)` | open | only skips when AST sees `component:` on a path record |
| G013 | 2026-11-25 | uncovered | options-to-composition | `data` holding a vue-router instance becomes deep `ref`, breaking `currentRoute` Ref | router fixture `probe` abstract routers | open | AI: use `shallowRef` for router instances after Options→setup |
| G021 | 2026-11-26 | uncovered | element / element-plus | dynamic `:icon="'el-icon-*'"` / `:class="…el-icon…"` still need AI mapping after static rewrite | `layout/index.vue` collapse/dark toggles | open | static icon attrs rewritten; dynamic left + AI-TODO |
| G025 | 2026-11-26 | uncovered | options-to-composition | kept Options API (`extends`) leaves Vue2-only `$createElement`/`$vnode`/`_uid`/`$destroy`/`$children` probes untouched | `options-api-coverage.vue` O19–O21/O26/O30–O31 | open | AI rewrites probes (`h` / `$.vnode` / `$.uid` / `app.unmount` typeof / `$refs.kid`); script only AI-TODO when keep-options |

## Fixed

| id | date | kind | area | symptom | repro | status | notes |
|----|------|------|------|---------|-------|--------|-------|
| G007 | 2026-11-25 | bug | migrate-filters | same-name filter skipped + AI-TODO; template kept calling method | `filters.upper` + `methods.upper` | fixed | rename to `__v23Filter_*` + mustache/v-bind rewrite |
| G016 | 2026-11-26 | bug | element / element-plus | generic `element-ui/`→`element-plus/` rewrote `packages/theme-chalk` to a non-existent Plus path | `styles/element-theme.scss` `@import 'element-ui/packages/theme-chalk/src/index'` | fixed | mask packages/theme-chalk before path-prefix; keep + AI-TODO |
| G017 | 2026-11-26 | bug | element / element-plus | `lib/locale` → `element-plus/es/locale` does not resolve under package exports; no `Locale.use` | `utils/theme.js` `import Locale from 'element-ui/lib/locale'` | fixed | stop root rewrite; AI-TODO ConfigProvider / app.use locale |
| G018 | 2026-11-26 | uncovered | element / element-plus | `el-submenu` not renamed to `el-sub-menu` | `layout/index.vue`, NavigationShowcase | fixed | template rewrite `el-submenu`→`el-sub-menu` |
| G019 | 2026-11-26 | bug | options-to-composition | `methods: { setBrand }` shorthand not emitted but `defineExpose` referenced `setBrand_1` | `Overview.vue` methods shorthand import | fixed | `methodFunctionNode` wraps Identifier as passthrough |
| G020 | 2026-11-26 | bug | options-to-composition | `data.form` + `ref="form"` + `this.$refs.form` collapsed; script-setup overwrote data on mount (login only last char) | `Login.vue` | fixed | collide → `formRef` + `tpl-ref-rename` template rewrite |
| G022 | 2026-11-26 | uncovered | element / element-plus | Element UI overrides painting border/bg on `.el-input__inner` double-box under Plus (`__wrapper`) | `styles/element-overrides.scss` | fixed | `rewriteInputChromeSelectors` in `element-plus.js` |
| G023 | 2026-11-26 | bug | options-to-composition | `this.$options.methods.foo` → `__v23Proxy?.$options.methods.foo` (undefined) so bind/call/apply scenario threw and later checks stayed blank | `options-script-edges-coverage.vue` S04–S09 | fixed | rewrite `this.$options.methods/computed.foo` to local binding |
| G024 | 2026-11-26 | uncovered | options-to-composition | `this.$children` left as-is (removed in Vue3); probeChildren failed after scenario | `options-script-edges-coverage.vue` S10–S11 | fixed | map to component `ref=` list from template when known |
| G008 | 2026-11-25 | uncovered | migrate-extend | `new Ctor()` / alias after `Vue.extend` not rewritten across files | `opt-edge-extend-base` + `probeExtend` | fixed | `__v23New` + teardown project pass |
| G010 | 2026-11-25 | bug | js-router | `migrateRouterScriptSetup` early-returned unless `this.$route` present; `$router`-only skipped | `function go(){ this.$router.push('/a') }` in `<script setup>` | fixed | gate on `$route` **or** `$router`; SFC scripts also run `migrateRouterModule` |
| G014 | 2026-11-25 | uncovered | options-to-composition | `const self = this` then `self.foo` not rewritten to setup refs | `hard-coverage.vue` guards | fixed | `expandThisAliases` → `this.foo` then normal ref rewrite |
| G015 | 2026-11-25 | uncovered | js-router | L04 still expected `xy-shape` after scroll field rename | `less-common-coverage` L04 | fixed | `rewriteScrollAssertHelpers`: xy-shape→lte-shape, sample.x\|y\|selector→left\|top\|el |
| G012 | 2026-11-25 | uncovered | js-router | `probe.currentRoute.x` / `obj.currentRoute` not rewritten to `.value` | abstract probe routers in fixtures | fixed | rewrite any `*.currentRoute` when file has vue-router/createRouter; also `match`→`resolve`, `getMatchedComponents`→`currentRoute.value.matched` |

## wontfix (intentional)

| id | date | kind | area | symptom | repro | status | notes |
|----|------|------|------|---------|-------|--------|-------|
| G009 | 2026-11-25 | uncovered | migrate-async-component | route-record `component: () => import()` not wrapped | `{ path, component: () => import() }` | wontfix | Vue Router 4 wants plain loaders — cannot-fully-auto |

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
| G012 | 2026-11-25 | uncovered | js-router | `probe.currentRoute.x` / `obj.currentRoute` not rewritten to `.value` | abstract probe routers in fixtures | open | only rewrites known `const router = createRouter` bindings |
| G013 | 2026-11-25 | uncovered | options-to-composition | `data` holding a vue-router instance becomes deep `ref`, breaking `currentRoute` Ref | router fixture `probe` abstract routers | open | AI: use `shallowRef` for router instances after Options→setup |

## Fixed

| id | date | kind | area | symptom | repro | status | notes |
|----|------|------|------|---------|-------|--------|-------|
| G007 | 2026-11-25 | bug | migrate-filters | same-name filter skipped + AI-TODO; template kept calling method | `filters.upper` + `methods.upper` | fixed | rename to `__v23Filter_*` + mustache/v-bind rewrite |
| G008 | 2026-11-25 | uncovered | migrate-extend | `new Ctor()` / alias after `Vue.extend` not rewritten across files | `opt-edge-extend-base` + `probeExtend` | fixed | `__v23New` + teardown project pass |
| G010 | 2026-11-25 | bug | js-router | `migrateRouterScriptSetup` early-returned unless `this.$route` present; `$router`-only skipped | `function go(){ this.$router.push('/a') }` in `<script setup>` | fixed | gate on `$route` **or** `$router`; SFC scripts also run `migrateRouterModule` |
| G014 | 2026-11-25 | uncovered | options-to-composition | `const self = this` then `self.foo` not rewritten to setup refs | `hard-coverage.vue` guards | fixed | `expandThisAliases` → `this.foo` then normal ref rewrite |
| G015 | 2026-11-25 | uncovered | js-router | L04 still expected `xy-shape` after scroll field rename | `less-common-coverage` L04 | fixed | `rewriteScrollAssertHelpers`: xy-shape→lte-shape, sample.x\|y\|selector→left\|top\|el |

## wontfix (intentional)

| id | date | kind | area | symptom | repro | status | notes |
|----|------|------|------|---------|-------|--------|-------|
| G009 | 2026-11-25 | uncovered | migrate-async-component | route-record `component: () => import()` not wrapped | `{ path, component: () => import() }` | wontfix | Vue Router 4 wants plain loaders — cannot-fully-auto |

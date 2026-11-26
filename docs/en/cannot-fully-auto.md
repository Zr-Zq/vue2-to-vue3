# Items That Cannot Be Fully Automated (Need Human / AI Solutions)

The preflight risk pipeline can **detect and register** the items below and, by default, **does not change logic**. It only inserts into source:

`/* migrate-script note: AI-TODO [category] … */`  
(Chinese legacy marker: `迁移脚本注释: AI-TODO`)  
(In templates: `<!-- migrate-script note: AI-TODO … -->` / Chinese legacy `<!-- 迁移脚本注释: AI-TODO … -->`)

AI resolves each comment; the script side does not rewrite semantics.

**Not in this list and never migrated by scripts:** `.env*` / `VUE_APP_*`↔`VITE_*` / `process.env`↔`import.meta.env` and project config — always handled when **AI builds the Vue3 base** (see `ai-scaffold-notes.md`).

**Already deterministic in scripts — no longer treated as risky (not in this list, no AI-TODO):**

- `.sync` to `v-model:`, drop `.native`, legacy slot to `v-slot`
- `keep-alive` + `:is` to add `:key`
- Instance `$on` / `$off` / `$once` to `this.$bus.*` + copy/register `src/compat/v23-bus.js`
- `render(h)` to drop h arg / flatten data / `$scopedSlotsto$slots`
- `Vue.extend` / `Sub.extend` to constructable `__v23Extend` (`src/compat/v23-extend.js`): still a function, so a dynamic `new variable()` and `typeof Ctor === 'function'` keep the Vue2 meaning. Direct and aliased call sites (`new SomeExtend()` / `const Ctor = SomeExtend; new Ctor()`, same file or via import) to `__v23New(Ctor, extra)`. `$mount` to `createApp().mount`
- Options to **`<script setup>`** (no `defineComponent`): `data`to`ref`, `computed` (get/set), `watch`, `provide`/`inject`, `filters`tomethods, lifecycleto`onXxx` (`beforeCreate` + `created` inline, in that order), `defineProps`/`defineEmits`/`defineOptions`, directivesto`vName`, drop `this`+`.value`, shadow alias, official `$` APIs, mixin flatten, bind/call + `this._*` analysis; plugin `migrate-options-composition`. **`options.model`toAI**
- **Async factories** to `defineAsyncComponent` (`() => import()`, object `{ component, loading, error, delay }`, `Vue.component('X', () => import())`); plugin `migrate-async-component`. Optionstosetup also inlines local `components` entries (incl. async) into `defineOptions.components`
- **TS type carry only** (never invent): existing `data(): { x: T }` to `ref<T>`; existing `PropType` / method annotations kept through `defineProps` / functions
- **Not owned by options-composition** (leave `this.$…` for dedicated plugins): `$router`/`$route` to `router`; `$store` / `map*` to `vuex`; `$i18n`/`$t`/`$tc`/… to `i18n`
- Lifecycle `beforeDestroy`/`destroyed` to `beforeUnmount`/`unmounted`
- `this.$set`/`Vue.set` to assignment; `$delete`/`Vue.delete` to `delete`
- `$listeners` to `$attrs`; template `v-on="$listeners"` to `v-bind="$attrs"`
- Custom directive hook name mapping (`bind`to`beforeMount`, etc.)
- Template `|` filters to function calls (HTML stream); `filters`to`methods` (JS stream via `.v23/handoff.json`; skip if not found)
- `>>>` `/deep/` `::v-deep` to `:deep()`
- Remove `Vue.config.productionTip` / `silent` assignments
- `<template functional>` / `functional: true` to normal components (`$props`/`$attrs`, drop `listeners`)
- **Element UI → Element Plus** (plugin `element`, mode `migrate`): `size` `medium`→`default` / `mini`→`small`; `el-button type="text"`→`text`; `el-link :underline`→`always|never`; date `format`/`value-format` fecha→dayjs (`yyyy`→`YYYY`, `dd`→`DD`, `WW`→`ww`, `timestamp`→`x`); `custom-class`→`class` on dialog/drawer; **`el-dialog` / `el-drawer` `:visible.sync` / `v-model:visible`→`v-model`**; `el-submenu`→`el-sub-menu`; static `icon`/`prefix-icon`/`suffix-icon`/`<i class="el-icon-*">`→PascalCase (register `@element-plus/icons-vue` globally); CSS chrome on `.el-input__inner` (border/background/box-shadow)→`.el-input__wrapper` + neutralize inner; `element-ui` package / prebuilt CSS / locale **lang** paths→`element-plus`. **Still AI:** dynamic `:icon` / leftover `el-icon-*`, `Vue.use(ElementUI)`→`createApp().use(ElementPlus)`, SCSS `theme-chalk` / `$--color-*` rebuild, `Locale.use`→`el-config-provider :locale` (do not rewrite `lib/locale` root or `packages/theme-chalk` blindly)
- **Base layout path renames** (`util`→`utils`, axios moved under `@/api/…`): AI fills `.v23/path-remap.md` + `path-remap.json`; script `v23-apply-path-remap` / `--step path-remap` rewrites imports **only** in `ingest-files.txt` (see `path-remap.md`)

---

1. **Same-node `v-for` + `v-if`** (`v-for-v-if`)  
   **Only when both are on the same element** — AI must migrate (typical Vue3: `<template v-for :key>` + inner `v-if`).  
   If `v-for` and `v-if` are on **different** elements/nodes: **no migration needed** (not reported).

2. **`$parent` / `$children` / `$root` and other instance-tree APIs** (`instance-api`)  
   `$parent` / `$root` bridge via setup-captured proxy. **`$children`**: when the SFC template has component `ref=` names, scripts rewrite to `[ref.value, …].filter(Boolean)`; otherwise **AI** (insert AI-TODO). `$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` are already handled by scripts.

3. **Child components mutating props (indirect / aliases)** (`props-mutation`)  
   Direct assignment can be detected; destructuring, aliases, and mutate-after-passthrough are often missed.

4. **Mixin same-name merge priority / global mixin injection** (`mixin-collision`)  
   Merge strategy and blast radius need product decisions; cannot merge blindly.

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` global side effects** (`global-side-effect`)  
   Must move to app-level APIs; `productionTip`/`silent` are already removed by scripts. `keyCodes`, `prototype`, and `mixin` still need humans.

   **AI spot-check (sample up to 5 when many hits):** verify each chosen registration has an equivalent under `createApp()` and that dependents still resolve:

   | # | Vue2 | Vue3 target | What AI verifies |
   |---|------|-------------|------------------|
   | 1 | `Vue.mixin({…})` | `app.mixin({…})` | Merge order / name collisions vs local mixins |
   | 2 | `Vue.prototype.$foo = …` | `app.config.globalProperties.$foo` | Call sites (`this.$foo`) and TS typings if any |
   | 3 | `Vue.config.errorHandler` | `app.config.errorHandler` | Still receives err / instance / info |
   | 4 | `Vue.config.warnHandler` | `app.config.warnHandler` | Dev warnings still routed |
   | 5 | `Vue.config.keyCodes` / `ignoredElements` | Drop `keyCodes` (Vue3); `app.config.compilerOptions.isCustomElement` for custom tags | No silent breakage on `.keyXxx` modifiers / Web Components |

   If `risks.json` lists more than five `global-side-effect` rows, pick five covering **mixin / prototype / errorHandler / warnHandler / keyCodes|ignoredElements** (or the closest present set); leave the rest marked AI-TODO for a later pass.

   **Sidecar non-SFC Options objects:** root dirs such as `script/` / `mock/` / `lib/` (see `sidecar-dirs.js`) may contain plain `export default { data(){}, methods:{} }` **without** a `.vue` SFC. Copy+pipeline may rewrite them toward `<script setup>` style, but `defineProps` / `defineEmits` are SFC macros — AI should move or wrap these into `.vue` when they are real components.

6. **`setup` mixed with Options strategy** (`setup-mix`)  
   Keep mixing vs full Composition is an architecture choice.

7. **`provide` of primitives** (`provide-primitive`)  
   Scripts wrap primitives in `ref` during OptionstoComposition and insert AI-TODO for inject callers (auto=`partial`).  
   **Scope:** literal string/number/boolean/null in `provide` / `provide()` return object.  
   **AI:** inject sites that treated the value as a raw primitive must use Ref (`.value`) or redesign.

8. **Options to Composition leftovers** (`options-to-composition`)  
   **Kept as Options API (not converted):** components with **imported** mixins or **`options.extends`** — scripts cannot flatten them from one file, and Vue3 still supports `mixins`/`extends`; only an AI-TODO `kept Options API (…)` is added, listing any Vue2-only instance APIs still used (`$createElement`, `$vnode`, `$destroy`, `$children`, `_uid` …) that AI must rewrite.  
   Still AI (wrap-up): **`options.model`**, kept-Options components above (leave as Options or convert to composables), **`$children`** when no component template refs are known, child **`$destroy`**, bare **`this.$options.methods`** bag reads (member access `this.$options.methods.foo` is rewritten to the local function), plain `.js`/`.ts` Options to move into `.vue` when macros needed. After wrap-up, **remove AI-TODO markers**.  
   **Deterministic now:** `this.$el` / bare `$refs` / `$parent` / `$root` / `$options` / `$forceUpdate` to `__v23Proxy?.…`, `$vnode` / `$destroy` to `__v23Proxy?.$.…` (proxy captured in setup, so safe inside methods); `$ssrContext` to setup-captured `useSSRContext()` (SSR builds only); `data()` prelude/shorthand/`this.prop` to IIFE/`props.*`; local `components` inlined into `defineOptions.components` (string `:is`); `defineExpose` for parent `$refs`.  
   **Data `this._xxx`:** if `_xxx` is a `data()` key, scripts rewrite it like other data (+ AI-TODO: Vue2 did not proxy underscore fields). Custom non-data fields (e.g. `this._timer = …`) to per-instance plain object `__v23Self._xxx` (non-reactive, same as Vue2). Vue-internal `_uid` etc. stay as `this._*`.

**Related deterministic edges (tests cover; not “risky” but scoped):**

| Topic | Script behavior | Out of scope |
|-------|-----------------|--------------|
| `$mount` + `router`/`store` | Both shorthand and `router: x` pulled to `.use(…)` (including first key after `{`) | pinia / i18n / custom plugins |
| `Vue.extend` / `Ctor.extend` | `__v23Extend` (function) and `__v23New` at `new` call sites, including aliases and imports. `new Ctor()` mounts via `createApp`; used as a component it renders the stateful definition. `extends` unwraps the base wrapper | `new Ctor({ data, store, router })` beyond `propsData` / `el`; `new` of a free global that is not an import or a local binding |
| Nested same-file `mixins: [mid]` | Recurse `mid.mixins` then mid, then host | `import`ed mixin modules (component kept as Options API) |
| Imported mixins / `extends` | Keep Options API + AI-TODO (no `<script setup>`) | Auto composable extraction |
| Plain `.js`/`.ts` Options / mixins | Detect + AI-TODO; **preserve** `export default` | Auto rewrite to `<script setup>` outside `.vue` |
| `data()` shorthand / `this.prop` init | IIFE init or `props.*` rewrite (no TDZ) | Non-prop `this` reads inside data() |
| Components + string `:is` | Inline factories into `defineOptions({ components })` (it is hoisted out of setup, so no script-setup locals); factories referencing module locals to `const` only (tag use) | Template rewrite of `:is` strings |
| `data()` key same name as an import | Internal ref renamed; no alias redeclaring the import | — |
| Public instance for `$refs` | `defineExpose` methods/data/computed | Selective expose policies |
| `filters` vs `methods` same name | Keep method; merge filter as `__v23Filter_<name>`; rewrite mustache / `v-bind` calls (Vue2 filters only appear there). Event handlers keep the method | Global `Vue.filter` registry; script `this.$options.filters` |
| Async `() => import()` / loading·error·delay object | to `defineAsyncComponent` (+ field rename); skip factories already under `defineAsyncComponent` | Custom Promise loaders (non-`import`); option objects with spreads / unknown keys are left untouched (no lossy rewrite); route-record `component: () => import()` stays a plain loader |
| Vue Router 3 (`router` plugin, default `migrate`) | Module (`.js` **and** `.vue` scripts): `new VueRouter` → `createRouter` + history; `*` catch-all; `scrollBehavior` x/y/selector → left/top/el **plus** common asserts (`xy-shape`→`lte-shape`, `sample.x\|y\|selector`); `addRoutes`/`onReady`/`currentRoute.value` (incl. `probe.value.currentRoute`); `match`→`resolve`; `getMatchedComponents()`→`currentRoute.value.matched`; drop `Vue.use` / push patches. After Options→setup: `$route`/`$router` → `useRoute`/`useRouter`; `const self = this` + `self.foo` expanded to refs | Prefer rewriting guard `next` to return values when touching guards; **keep-options**; store abstract probe routers in `shallowRef` not deep `ref` (G013) |
| Dynamic `import()` with concatenated / template path | `import('@/views/' + n + '.vue')` to `import.meta.glob('<relative dir>/**/*.vue')` + key lookup (rejects like webpack when missing) | No extension suffix, bare package prefixes, fully dynamic paths |
| TS annotations already in source | Carry into `ref<T>` / `defineProps` / method sigs | Inventing generics or PropType where none existed |
| `ingest` copy | Also copies styles/assets (scss/css/images/fonts…); keeps `.vue` in rewritten imports | Env / project config (AI base) |

9. **`vue-class-component` / decorators** (`typescript-class`)  
   `@Component` / `@Prop` / `@Watch` / `vue-property-decorator` (etc.): **detect + AI-TODO only** — scripts do **not** rewrite to Options or `<script setup>`.  
   **AI:** convert to Options first, or hand-migrate Composition; then re-run the JS stream if needed.

---

Detection results after a run:

- `<project>/.v23/risks.json` (kept when `--keep`)
- Repo `output/<project>-risks/` (backed up after each run)

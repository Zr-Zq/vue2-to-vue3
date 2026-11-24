# Items That Cannot Be Fully Automated (Need Human / AI Solutions)

The preflight risk pipeline can **detect and register** the items below and, by default, **does not change logic**. It only inserts into source:

`/* migrate-script note: AI-TODO [category] … */`  
(Chinese legacy marker: `迁移脚本注释: AI-TODO`)  
(In templates: `<!-- migrate-script note: AI-TODO … -->` / Chinese legacy `<!-- 迁移脚本注释: AI-TODO … -->`)

AI resolves each comment; the script side does not rewrite semantics.

**Not in this list and never migrated by scripts:** `.env*` / `VUE_APP_*`↔`VITE_*` / `process.env`↔`import.meta.env` and project config — always handled when **AI builds the Vue3 base** (see `ai-scaffold-notes.md`).

**Already deterministic in scripts — no longer treated as risky (not in this list, no AI-TODO):**

- `.sync` → `v-model:`, drop `.native`, legacy slot → `v-slot`
- `keep-alive` + `:is` → add `:key`
- Instance `$on` / `$off` / `$once` → `this.$bus.*` + copy/register `src/compat/v23-bus.js`
- `render(h)` → drop h arg / flatten data / `$scopedSlots→$slots`
- `Vue.extend` → `defineComponent`; `$mount` → `createApp().mount`
- `$children` → approximate `__v23Children(this)`
- Lifecycle `beforeDestroy`/`destroyed` → `beforeUnmount`/`unmounted`
- `this.$set`/`Vue.set` → assignment; `$delete`/`Vue.delete` → `delete`
- `$listeners` → `$attrs`; template `v-on="$listeners"` → `v-bind="$attrs"`
- Custom directive hook name mapping (`bind`→`beforeMount`, etc.)
- Template `|` filters → function calls (HTML stream); `filters`→`methods` (JS stream via `.v23/handoff.json`; skip if not found)
- `>>>` `/deep/` `::v-deep` → `:deep()`
- Remove `Vue.config.productionTip` / `silent` assignments
- `<template functional>` / `functional: true` → normal components (`$props`/`$attrs`, drop `listeners`)

---

1. **Same-node `v-for` + `v-if`** (`v-for-v-if`)  
   **Only when both are on the same element** — AI must migrate (typical Vue3: `<template v-for :key>` + inner `v-if`).  
   If `v-for` and `v-if` are on **different** elements/nodes: **no migration needed** (not reported).

2. **`$parent` / `$root` and other instance-tree APIs** (`instance-api`)  
   Depends on the runtime component tree. `$children` / `$listeners` / `$scopedSlots` / `$on`/`$off`/`$once` are already handled by scripts.

3. **Child components mutating props (indirect / aliases)** (`props-mutation`)  
   Direct assignment can be detected; destructuring, aliases, and mutate-after-passthrough are often missed.

4. **Mixin same-name merge priority / global mixin injection** (`mixin-collision`)  
   Merge strategy and blast radius need product decisions; cannot merge blindly.

5. **`Vue.mixin` / `Vue.config` / `Vue.prototype` global side effects** (`global-side-effect`)  
   Must move to app-level APIs; `productionTip`/`silent` are already removed by scripts. `keyCodes`, `prototype`, and `mixin` still need humans.

6. **`setup` mixed with Options strategy** (`setup-mix`)  
   Keep mixing vs full Composition is an architecture choice.

7. **`provide` of primitives is not reactive** (`provide-primitive`)  
   Wrapping in `ref` changes how every inject consumer reads values.

---

Detection results after a run:

- `<project>/.v23/risks.json` (kept when `--keep`)
- Repo `output/<project>-risks/` (backed up after each run)

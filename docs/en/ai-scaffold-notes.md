# AI Base Scaffold: Notes

Migration step 2 has the **AI create the target project base** (`--to`). The base stack is **Vue 3** (prefer Vite). Script `--scaffold` only copies the in-repo legacy Vue2 template; **do not rely on it for real migrations**.

### Ownership (hard rule)

| Who | Owns |
|-----|------|
| **AI** | Build the **Vue3** base; **all** project config; install deps; **able to start**; layout **seamlessly ready for script** copy/pipeline |
| **Scripts** | analyze / copy / deterministic syntax transforms / AI-TODO / check-refs; **must NOT** touch `.env*`, `VUE_APP_*`↔`VITE_*`, or `process.env`↔`import.meta.env` |

### Done bar for the base (before script copy)

AI must finish scaffolding to this bar — not a hollow shell:

1. **Full project config** from the source, upgraded for Vue3 + Vite (see table below).
2. **`package.json` complete**: Vue3 stack + every runtime/dev dep the source needs (UI, utils, loaderstoVite plugins, etc.).
3. **`npm install` (or pnpm/yarn) succeeded** under `--to`; `node_modules` present.
4. **Dev server can start**: `npm run dev` (or the base’s start script) boots without missing-module / missing-config errors. A minimal `main` + router stub is OK until script copy fills business pages.
5. Env, alias, proxy, public assets, lint/tsconfig, and CDN decisions are already in place.
6. **Seamless script handoff**: after AI finishes, `v23-migrate --from … --to … --step script` (or default) can run **without** extra base fixes, `--scaffold`, or env/config workarounds.

### Seamless handoff with scripts

The base must match what the scripts already assume so copy / import rewrite / pipeline plug in without glue:

| Requirement | Why |
|-------------|-----|
| Root has `package.json` (prefer also `vite.config.*` and `jsconfig.json` / `tsconfig.json`) | `looksLikeProject(--to)` must be true; otherwise migrate pauses for “AI base” |
| Default app tree under **`src/`** (same as source `--src` / `--dest-src`) | Script copy is path-relative; odd layouts force special flags |
| Alias **`@` to `src`** (and `~` if the source used it); keep `jsconfig`/`tsconfig` paths in sync with Vite | `ingest` / `rewrite-imports` resolve and rewrite against the **base** alias; **keep `.vue` extensions** (Vite); ingest also copies styles/assets (scss/css/images/fonts), not only SFC/JS |
| Root engineering files only from AI (env, Vite, package.json, lint…) | Scripts **never** migrate env/project config — they must already be correct |
| Stub `src/main.js` / router OK to be **overwritten** by copy | Do not invent a layout that copy cannot overlay onto. Copied Vue2 `router/index.js` and layouts are migrated by the pipeline (`router` plugin to Vue Router 4, `migrate-dynamic-import` to `import.meta.glob`); do **not** restore the base versions by hand |
| No waiting on scripts for missing deps, alias, or proxy | Handoff = AI done to script copy+pipeline to AI-TODO only for syntax/semantics |

If the source used non-`src` roots, mirror that with matching `--dest-src` and document it in `.v23/scaffold-notes.md`; default remains `src/`.

## Build tool: prefer Vite

- **Default to Vite + Vue 3** for the base (`create-vue` or a hand-written `vite.config` are both fine).
- **Do not default to webpack / vue-cli** unless the user explicitly asks, or the source strongly depends on webpack for a short-term preview.
- Recommended dependency direction: `vue@3`, `vue-router@4`, `pinia` or `vuex@4` as needed, UI chosen to match the source (e.g. Element Plus).
- When `--from` is `element-ui-demo` (or any app on `element-ui`): base must use **Element Plus**, and register globally/on-demand like source `Vue.use(ElementUI)`. Script plugin `element` (`mode: migrate`) already rewrites size / `type="text"` / date formats / package imports / `el-submenu`→`el-sub-menu`; AI still owns **icons** (`@element-plus/icons-vue`), **`createApp().use(ElementPlus)`** wiring, SCSS theme rebuild, and **`Locale.use`→ConfigProvider locale**.
- Entry: `index.html` + `src/main.js` (or `.ts`), `resolve.alias['@'] to src`.
- **Env vars**: AI maps source `.env*` to `VITE_*` and code to `import.meta.env` (do not wait for scripts).
- **Install**: run the package manager install yourself; do not leave “deps TBD” for scripts or the user.

## Replicate “all project-level config” from the source

When scaffolding, AI must compare against the **migration source (`--from`)** and migrate / replicate **every** project-level config into the base — not just spin up an empty Vite shell — then install and verify start.

### Config surfaces that must be scanned and handled

| Source (examples) | Action on the base |
|-------------------|--------------------|
| `package.json` dependencies / scripts | Upgrade to Vue3-ecosystem equivalents; keep business script intent (build/lint/analyz, etc.) |
| `vue.config.js` / `webpack.config.*` | Convert to `vite.config`: alias, proxy, publicPath, define, static dirs, minify, etc. |
| `.env*` / `process.env.VUE_APP_*` | **AI only** (scripts must not touch env): switch to `VITE_*` + `import.meta.env`; keep names aligned |
| `babel.config.*` / `.browserslistrc` | Mostly defaults under Vite; record special polyfills/plugins in the base or as AI-TODO |
| `postcss` / `sass` / `less` config | Recreate the same capabilities in Vite |
| `eslint` / `prettier` / `editorconfig` | Copy into the base and adjust for Vue3 syntax |
| `jsconfig` / `tsconfig` paths | Keep consistent with Vite alias |
| `public/` static assets, favicon, unpackaged html | Copy into base `public/` |
| meta / title / injects in `index.html` | Write into Vite root `index.html` |
| Path aliases, CDN externals, gzip, analyzer plugins | Implement equivalently in Vite via `build.rollupOptions` / plugins |

Principles:

- **Semantic alignment**: Config that “did something” in the source must have a counterpart in the base, or an explicit “deprecated / not needed” note (may live in `to/.v23/scaffold-notes.md`).
- **Version upgrades**: Replicating config is not pasting the Vue2 toolchain as-is; the goal is **behavior equivalence under Vue3 + Vite**.
- Business pages are still filled by script `copy`; AI owns the **engineering shell + config + dependency choices**.

## CDN handling

First decide whether the asset is “the project’s own package / Vue stack dependency”, then decide whether to manage the CDN.

### Can ignore (skip)

When all of the following apply, or it clearly matches these cases, you **need not** convert CDN to an npm dependency:

1. **Pure HTML / pure JS fragments**: no Vue, Element, Vue Router, or Vuex (no `new Vue`, no `Vue.use`, no related globals driving the app framework); or  
2. **Standalone third-party utilities**: own usage, unrelated to the app framework (analytics, map SDK demos, single-page snippets, etc.), and the source does not depend on the same package in `package.json`.

These may keep `<script src="https://...">` / external CSS; just ensure `index.html` / static pages are copied into the base.

### Must handle

If any of the following apply, the CDN **must not be silently ignored**:

| Case | Action |
|------|--------|
| CDN provides **Vue / vue-router / vuex / Element** (or another stack already declared in `package.json`) | Base uses **npm deps + import**; remove (or conditionalize) CDN to avoid dual runtimes |
| `webpack externals` / `vue.config` externalizes those libs to CDN | Under Vite, either bundle normally or use explicit `rollupOptions.external` + `index.html` inject, and document global name mapping |
| Business code assumes globals `Vue` / `ELEMENT` / `VueRouter` / `Vuex` | Switch to module imports; if CDN is kept short-term, document global names and load order in the base notes |
| Same lib on both CDN and `package.json` | **Prefer package**, remove duplicate CDN to avoid dual Vue instances |

### Decision flow (for AI)

```
Read index.html / entry html / build externals
  ├─ References vue / router / vuex / element (or a lib already in package)?
  │     to Must handle: npm-ify or explicit external; never silently keep dual copies
  └─ Pure utility CDN, and the project does not load it via the Vue stack?
        to Can ignore: copy as-is into public / html
```

When unsure: record in `ai-todos.md` / `scaffold-notes.md` with tag `CDN`; do not silently drop it.

## Root-level sidecar dirs (`script/` / `test/` / `style/` …)

Many legacy projects have sidecars **outside `src`**, for example:

`script/`, `scripts/`, `test/`, `tests/`, `style/`, `styles/`, `mock/`, `docs/`, `static/`, `vendor/`, `cdn/`, root-level `assets/`, etc.

### Never migrate (hard excludes)

Do **not** copy/scan these as sidecars (even if present at the source root):

`node_modules/`, `dist/`, `build/`, `coverage/`, `.git/`, `.v23/`, and common build-cache dirs.

The base runs its own `npm install`; artifacts are rebuilt by the base. AI must not copy these when scaffolding either.

### Script side (already supported)

- **copy**: after copying `src`, `v23-migrate` **copies whole existing sidecar dirs at the source root to the same path under `--to`** (backup before overwrite); `node_modules`/`dist` etc. are outside the allowlist and hard-excluded.
- **pipeline / analyze**: default `include` already covers js/ts/vue/css/html under these dirs; plugins usually skip naturally when there is no Vue-stack syntax.

### How AI should decide

| Case | Action |
|------|--------|
| Directory exists | Must enter the base (do not stop after migrating only `src`) |
| Pure HTML/JS, **not** using Vue / Element / Router / Vuex | **No rewrite needed**: keep as-is (same as CDN “can ignore”) |
| Contains `new Vue` / `from 'vue'` / element / router / vuex | Run through the migration pipeline; mark AI-TODO if it fails |
| Tests depend on Jest/Karma etc. | Replicate config for Vite/Vitest (or note in scaffold-notes) |

Rule of thumb: ensure it is **copied first**, then decide **whether to rewrite** based on Vue-stack usage.

## Minimal base layout

```
<to>/
  package.json              # deps aligned to the upgraded stack from the source
  vite.config.js
  index.html                # keep non-framework CDN if needed
  .env* / .editorconfig / eslint etc. (replicated from source)
  public/
  src/
    main.js
    App.vue
    router/                 # can be a stub; wire after copy
  .v23/scaffold-notes.md    # optional: config/CDN decision notes
  .gitignore
```

- `npm install` should work; `npm run dev` opening a blank shell is enough.
- **Do not** pre-stuff business pages into the base; business content is ingested by script `copy/ingest` from `--from`.

## Known pitfalls (scaffolding / preview)

### 1. Multiple `<style>` and vue-loader@15 (webpack path only)

If you temporarily use **webpack + vue-loader@15** (Vue2 preview experiments):

- Multiple `<style>` in one `.vue` often false-positives:
  `export 'default' (imported as 'style0'|'style1'|…) was not found`
- **Migration did not break CSS**; styles are usually injected/extracted — safe to ignore.
- Suggested webpack config:

```js
ignoreWarnings: [
  { message: /export 'default' \(imported as 'style\d+'\) was not found/ },
]
```

- **Vite bases do not have this issue**, which is why real Vue3 bases prefer Vite.

### 2. Vue2 preview vs Vue3 base

- `my-vue-app` / HTML preview streams may still be Vue2 + webpack, used only to accept template rewrites.
- **Migration target `--to` should be Vue3 + Vite**; do not treat a Vue2 experiment as the final base.

### 3. Source project protection

- For source dirs the user marks “do not delete” (e.g. `my-vue-app`): add/edit only; do not delete or `/MIR`-wipe.
- Write migration output to a separate `--to` / `output/...`, isolated from the source.

### 4. HTML / JS stream split

- When HTML runs before JS, check `<to>/.v23/handoff.json`.
- After template `|filter`tofunction call, the JS stream must run `migrate-filters` (or consume handoff); skip if not found.

## AI self-check list

After scaffolding, confirm (all required unless noted):

1. [ ] Using **Vite + Vue3** (unless the user asked otherwise)
2. [ ] Source **all project config** replicated / equivalently migrated (env, alias, proxy, lint, public, scripts, etc.)
3. [ ] **Dependencies listed and installed** (`npm install` / pnpm / yarn OK; no missing peer/runtime modules for the stack)
4. [ ] **`npm run dev` (or start script) actually starts** without config/module errors
5. [ ] **Seamless with scripts**: `looksLikeProject` OK; `src/` (or documented dest-src); `@` alias; no post-AI config/env work left for scripts
6. [ ] **CDN**: framework libs npm-ified or explicitly external; unrelated pure HTML/JS CDN may stay
7. [ ] Root **`script/` / `test/` and other sidecars** copied into the base; non-Vue stack need not be rewritten
8. [ ] `@` to `src` alias configured (and paths files agree with Vite)
9. [ ] No accidental deletion of source project files
10. [ ] Webpack multi-style false positives not treated as migration failure
11. [ ] (Recommended) Write `.v23/scaffold-notes.md` covering config, CDN, sidecar, and any non-default dest-src
12. [ ] If the base renamed/moved dirs vs source (`util`→`utils`, axios path, …), fill `.v23/path-remap.md` + `path-remap.json` and run `--step path-remap` (see `path-remap.md`; scoped to `ingest-files.txt` only)

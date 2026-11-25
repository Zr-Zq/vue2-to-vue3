/**
 * Unit tests for Options → Composition + this rebinding
 *   node test/options-composition.test.js
 */
const assert = require('assert')
const { migrateOptionsToComposition } = require('../src/transform/options-to-composition')
const { analyzeThisRebinding } = require('../src/transform/this-rebinding')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== data → ref + drop this ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { count: 0 } },
      methods: {
        inc() { this.count += 1; return this.count }
      },
      mounted() { this.inc() }
    }`
  )
  ok(/const count = ref\(0\)/.test(r.code), 'data → ref(0)')
  ok(/count\.value \+= 1/.test(r.code), 'this.count → count.value')
  ok(/function inc\(/.test(r.code), 'method → function')
  ok(/onMounted\(/.test(r.code), 'mounted → onMounted')
  ok(/\/\* v23:composition \*\//.test(r.code), 'composition marker')
  ok(!/this\.count/.test(r.code), 'no this.count left')
  ok(!/defineComponent/.test(r.code), 'no defineComponent')
  ok(!/export\s+default/.test(r.code), 'no export default (script setup)')
  ok(r.changes.some((c) => c.kind === 'script-setup'), 'script-setup change')
}

console.log('== param shadow rename (expose original) ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { count: 1 } },
      methods: {
        bump(count) { this.count = count + this.count; return this.count }
      }
    }`
  )
  ok(/const count_1 = ref\(1\)/.test(r.code), 'data renamed count_1')
  ok(/function bump\(count\)/.test(r.code), 'param stays count')
  ok(/count_1\.value = count \+ count_1\.value/.test(r.code), 'uses count_1.value')
  ok(/const count = count_1/.test(r.code), 'script-setup alias count = count_1')
  ok(r.changes.some((c) => c.kind === 'rename-shadow' && c.from === 'count'), 'rename-shadow recorded')
}

console.log('== official $emit / $nextTick / $refs ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { n: 0 } },
      methods: {
        go() {
          this.$nextTick(() => { this.n++ })
          this.$refs.box.focus()
          this.$emit('done', this.n)
        }
      }
    }`
  )
  ok(/nextTick\(/.test(r.code), '$nextTick → nextTick')
  ok(/box\.value\.focus\(/.test(r.code), '$refs.box → box.value')
  ok(/\bemit\('done'/.test(r.code), '$emit → emit')
  ok(/defineEmits\(/.test(r.code), 'defineEmits')
  ok(/const emit = defineEmits/.test(r.code), 'const emit = defineEmits')
  ok(!/this\.\$emit/.test(r.code), 'no this.$emit')
}

console.log('== $parent/$root proxy; $children AI ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      methods: {
        up() {
          this.$parent.open()
          this.$children[0].focus()
          this.$root.$emit('x')
        }
      }
    }`
  )
  ok(/__v23Proxy\s*\?\.\s*\$parent/.test(r.code), '$parent → proxy')
  ok(/this\.\$children/.test(r.code), '$children left')
  ok(/__v23Proxy\s*\?\.\s*\$root/.test(r.code), '$root → proxy')
  ok(/AI-TODO: \[instance-api\].*\$children/.test(r.code), 'AI-TODO $children')
  ok(!/defineEmits\(/.test(r.code), '$root.$emit does not force defineEmits')
  ok(r.changes.some((c) => c.kind === 'ai-instance-tree'), 'ai-instance-tree change')
}

console.log('== bind/call/apply record + borrowed fallback ==')
{
  const src = `export default {
    data() { return { x: 1 } },
    methods: {
      read() { return this.x },
      run() {
        this.read.bind({ x: 99 })
        return this.read.call({ x: 2 })
      }
    }
  }`
  const a = analyzeThisRebinding(src)
  ok(a.sites.length === 2, '2 rebinding sites')
  ok(a.sites.every((s) => s.incomingThis === 'foreign'), 'incomingThis foreign')
  ok(a.borrowedMethods.has('read'), 'read marked borrowed')

  const r = migrateOptionsToComposition(src)
  ok(/v23:this-rebinding/.test(r.code), 'rebinding comment present')
  ok(/incomingThis":"foreign"/.test(r.code), 'records incomingThis')
  ok(/this && "x" in this \? this\.x : x\.value/.test(r.code), 'dynamic this fallback')
  ok(/read\.call\(\{\s*x:\s*2\s*\}\)/.test(r.code), 'call kept on function')
}

console.log('== lost this (null/undefined) ==')
{
  const a = analyzeThisRebinding(
    `export default { methods: { f(){}, g(){ this.f.call(null); this.f.apply(undefined, []) } } }`
  )
  ok(a.sites.length === 2, '2 lost sites')
  ok(a.sites.every((s) => s.incomingThis === 'lost'), 'incomingThis lost')
  ok(a.borrowedMethods.has('f'), 'f borrowed')
}

console.log('== component-this bind is not borrowed ==')
{
  const a = analyzeThisRebinding(
    `export default { methods: { f(){}, g(){ const x = this.f.bind(this) } } }`
  )
  ok(a.sites.length === 1 && a.sites[0].incomingThis === 'component', 'component this')
  ok(!a.borrowedMethods.has('f'), 'not borrowed')
}

console.log('== local mixin flatten (later wins) ==')
{
  const r = migrateOptionsToComposition(
    `const base = {
      data() { return { a: 1, shared: 'base' } },
      methods: {
        hello() { return this.shared },
        onlyBase() { return 1 }
      }
    }
    export default {
      mixins: [base],
      data() { return { shared: 'child', b: 2 } },
      methods: {
        hello() { return this.shared + '-' + this.b }
      }
    }`
  )
  ok(/const a = ref\(1\)/.test(r.code), 'mixin data a kept')
  ok(/const shared = ref\(['"]child['"]\)/.test(r.code), 'child shared wins')
  ok(/const b = ref\(2\)/.test(r.code), 'child b')
  ok(/function onlyBase\(/.test(r.code), 'mixin-only method kept')
  ok(/shared\.value \+ '-' \+ b\.value/.test(r.code), 'child hello wins')
  ok(!/unresolved mixins/.test(r.code), 'no unresolved for local id')
}

console.log('== imported mixin unresolved AI-TODO ==')
{
  const r = migrateOptionsToComposition(
    `import base from './base'
    export default {
      mixins: [base],
      data() { return { x: 1 } }
    }`
  )
  ok(/unresolved mixins:\s*base/.test(r.code), 'AI-TODO unresolved mixin')
  ok(/mixins: \[base\]/.test(r.code) && /data\(\) \{ return \{ x: 1 \} \}/.test(r.code), 'Options kept as-is')
  ok(!/v23:composition/.test(r.code) && !/ref\(/.test(r.code), 'not converted to script setup')
  ok(r.skipped === 'keep-options', 'skipped keep-options')
}

console.log('== extends kept as Options API ==')
{
  const r = migrateOptionsToComposition(
    `import Base from './Base.vue'
    export default {
      extends: Base,
      data() { return { x: 1 } }
    }`
  )
  ok(/kept Options API \(options\.extends\)/.test(r.code), 'AI-TODO extends')
  ok(/extends: Base/.test(r.code) && r.skipped === 'keep-options', 'Options kept')
  ok(!/Vue2-only instance APIs/.test(r.code), 'no removed-API note when none used')
}

console.log('== kept Options lists Vue2-only instance APIs ==')
{
  const r = migrateOptionsToComposition(
    `import Base from './Base.vue'
    export default {
      extends: Base,
      methods: {
        probe() { return [typeof this.$createElement, !!this.$vnode, this._uid, this.$children.length] }
      }
    }`
  )
  ok(/Vue2-only instance APIs used: \$createElement, \$vnode, \$children, _uid/.test(r.code), 'removed APIs listed')
}

console.log('== computed + props ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      props: { label: String },
      data() { return { n: 1 } },
      computed: {
        text() { return this.label + ':' + this.n }
      }
    }`
  )
  ok(/computed\(/.test(r.code), 'computed()')
  ok(/props\.label/.test(r.code), 'this.label → props.label')
  ok(/n\.value/.test(r.code), 'this.n → n.value')
  ok(/defineProps\(/.test(r.code), 'defineProps')
}

console.log('== skip already migrated / has setup ==')
{
  const a = migrateOptionsToComposition('/* v23:composition */\nexport default { setup() {} }')
  ok(a.skipped === 'already-migrated', 'skip marker')
  const b = migrateOptionsToComposition('export default { setup() { return {} }, data() { return { a: 1 } } }')
  ok(b.skipped === 'has-setup', 'skip has setup')
}

console.log('== created inlined into setup ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { ready: false } },
      created() { this.ready = true }
    }`
  )
  ok(/ready\.value = true/.test(r.code), 'created body inlined')
  ok(!/onBeforeMount/.test(r.code) || r.changes.some((c) => c.to === 'setup-inline'), 'created → setup-inline')
}

console.log('== beforeCreate folded into setup + lifecycle fill ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { n: 0 } },
      beforeCreate() { window.__bc = 1; this._bc = true },
      created() { window.__seen = !!this._bc },
      beforeUpdate() { this.n++ },
      updated() { this.n++ },
      activated() { this.n++ },
      deactivated() { this.n++ },
      errorCaptured(err) { return false }
    }`
  )
  ok(!/AI-TODO: \[options-to-composition\] beforeCreate/.test(r.code), 'no beforeCreate AI marker')
  ok(!/beforeCreate\s*\(/.test(r.code), 'beforeCreate hook not kept as option')
  const bcAt = r.code.indexOf('window.__bc = 1')
  const crAt = r.code.indexOf('window.__seen')
  ok(bcAt > -1 && crAt > bcAt, 'beforeCreate body inlined before created body')
  ok(/const __v23Self = \{\}/.test(r.code), 'self object declared')
  ok(/__v23Self\._bc = true/.test(r.code) && /!!__v23Self\._bc/.test(r.code), 'custom _bc shared via __v23Self')
  ok(!/this\._bc/.test(r.code), 'no leftover this._bc')
  ok(/onBeforeUpdate\(/.test(r.code), 'beforeUpdate → onBeforeUpdate')
  ok(/onUpdated\(/.test(r.code), 'updated → onUpdated')
  ok(/onActivated\(/.test(r.code), 'activated → onActivated')
  ok(/onDeactivated\(/.test(r.code), 'deactivated → onDeactivated')
  ok(/onErrorCaptured\(/.test(r.code), 'errorCaptured → onErrorCaptured')
  ok(r.changes.some((c) => c.kind === 'lifecycle' && c.from === 'beforeCreate'), 'beforeCreate inline change')
}

console.log('== computed get/set ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { n: 1 } },
      computed: {
        doubled: {
          get() { return this.n * 2 },
          set(v) { this.n = v / 2 }
        }
      }
    }`
  )
  ok(/computed\(\{/.test(r.code), 'computed({ get, set })')
  ok(/get:\s*\(\)\s*=>/.test(r.code), 'has get')
  ok(/set:\s*v\s*=>/.test(r.code) || /set:\s*\(/.test(r.code), 'has set')
  ok(/n\.value \* 2/.test(r.code), 'get uses n.value')
  ok(/n\.value = v \/ 2/.test(r.code), 'set uses n.value')
}

console.log('== watch / provide / inject ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      inject: {
        theme: { from: 'theme', default: 'light' },
        lab: 'labKey'
      },
      data() { return { count: 0, profile: { age: 1 } } },
      methods: {
        onCount(n) { this.count = n }
      },
      watch: {
        count(n) { this.onCount(n) },
        'profile.age': { handler: 'onCount', deep: true, immediate: true }
      },
      provide() {
        return { count: this.count, flag: 1 }
      }
    }`
  )
  ok(/inject\(['"]theme['"]/.test(r.code), 'inject theme')
  ok(/inject\(['"]labKey['"]/.test(r.code), 'inject alias from')
  ok(/watch\(count,/.test(r.code), 'watch(count')
  ok(/watch\(\(\)\s*=>\s*profile\.value\.age/.test(r.code), 'watch path getter')
  ok(/deep:\s*true/.test(r.code), 'watch deep')
  ok(/immediate:\s*true/.test(r.code), 'watch immediate')
  ok(/provide\(['"]count['"],\s*count\)/.test(r.code), 'provide ref')
  ok(/provide\(['"]flag['"],\s*ref\(1\)\)/.test(r.code), 'provide primitive → ref')
  ok(/const theme = inject\(/.test(r.code), 'inject top-level (script setup)')
}

console.log('== filters remnant + inheritAttrs + model AI ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      inheritAttrs: false,
      model: { prop: 'value', event: 'input' },
      props: { value: String },
      filters: {
        upper(v) { return String(v).toUpperCase() }
      },
      data() { return { raw: 'ab' } },
      directives: {
        focus: { mounted() {} }
      }
    }`
  )
  ok(/defineOptions\(/.test(r.code) && /inheritAttrs:\s*false/.test(r.code), 'defineOptions inheritAttrs')
  ok(/const vFocus =/.test(r.code), 'directive → vFocus')
  ok(/function upper\(/.test(r.code), 'filters → method in setup')
  ok(/AI-TODO: \[options-to-composition\] options\.model/.test(r.code), 'model AI')
}

console.log('== this.$refs/$el AI + $data/$props/$createElement/$vnode/$options/_xxx ==')
{
  const { analyzeThisUnderscore } = require('../src/transform/this-rebinding')
  const src = `export default {
    props: { title: String },
    data() { return { n: 1 } },
    methods: {
      dump() {
        const all = this.$refs
        const el = this.$el
        const d = this.$data.n
        const p = this.$props.title
        const vnode = this.$vnode
        const opts = this.$options.name
        const h = this.$createElement
        const uid = this._uid
        const mine = this._myFlag
        return { all, el, d, p, vnode, opts, h, uid, mine }
      },
      focusBox() { this.$refs.box.focus() }
    }
  }`
  const u = analyzeThisUnderscore(src)
  ok(u.sites.some((s) => s.name === '_uid' && s.kind === 'vue-internal'), '_uid vue-internal')
  ok(u.sites.some((s) => s.name === '_myFlag' && s.kind === 'custom-or-unknown'), '_myFlag custom')

  const r = migrateOptionsToComposition(src)
  ok(/v23:this-underscore/.test(r.code), 'underscore comment')
  // _myFlag not in data() here — custom instance field → __v23Self._myFlag
  ok(/__v23Self\._myFlag/.test(r.code) && !/this\._myFlag/.test(r.code), 'custom _xxx not in data → __v23Self')
  ok(/this\._uid/.test(r.code), 'internal _uid left as-is')
  ok(/__v23Proxy\s*\?\.\s*\$refs/.test(r.code), 'bare $refs → __v23Proxy?.$refs')
  ok(!/AI-TODO: \[options-to-composition\] bare this\.\$refs/.test(r.code), 'no bare $refs AI-TODO')
  ok(!/v23Refs/.test(r.code), 'no v23Refs bag')
  ok(/box\.value\.focus/.test(r.code), '$refs.box still → box.value')
  ok(/__v23Proxy\s*\?\.\s*\$el/.test(r.code), '$el → __v23Proxy?.$el')
  ok(/const __v23Proxy = getCurrentInstance\(\)\s*\?\.\s*proxy/.test(r.code), 'setup captures proxy')
  ok(!/AI-TODO: \[options-to-composition\] this\.\$el/.test(r.code), 'no $el AI-TODO')
  ok(!/\bthis\.\$el\b/.test(r.code.replace(/\/\*[\s\S]*?\*\//g, '')), 'no leftover this.$el in code')
  ok(!/rootEl/.test(r.code), 'no auto rootEl')
  ok(/v23Data/.test(r.code) && /get n\(/.test(r.code), '$data → v23Data')
  ok(/props\.title/.test(r.code), '$props.title → props.title')
  ok(/\bh\b/.test(r.code) && /from "vue"/.test(r.code), '$createElement → h import')
  ok(/__v23Proxy\?\.\$\.vnode/.test(r.code), '$vnode → __v23Proxy?.$.vnode')
  ok(/__v23Proxy\s*\?\.\s*\$options/.test(r.code), '$options → proxy')
  ok(/defineExpose\(/.test(r.code), 'defineExpose emitted')
}

console.log('== $forceUpdate / $destroy / $isServer / $ssrContext / emit names / serverPrefetch ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { x: 1 } },
      methods: {
        go() {
          this.$forceUpdate()
          this.$destroy()
          if (this.$isServer) return
          const ctx = this.$ssrContext
          this.$emit('save', this.x)
          this.$emit('done')
          return ctx
        }
      },
      serverPrefetch() { return Promise.resolve() },
      renderTracked() {},
      renderTriggered() {}
    }`
  )
  ok(/__v23Proxy\?\.\$forceUpdate/.test(r.code), '$forceUpdate → __v23Proxy?.$forceUpdate')
  ok(/__v23Proxy\?\.\$\.appContext\.app\.unmount/.test(r.code), '$destroy → app.unmount via proxy')
  ok(!/getCurrentInstance\(\)\.(proxy|appContext)/.test(r.code), 'no getCurrentInstance() inside methods')
  ok(/import\.meta\.env\.SSR/.test(r.code), '$isServer → import.meta.env.SSR')
  ok(/const __v23SsrContext = import\.meta\.env\.SSR \? useSSRContext\(\) : undefined/.test(r.code), '$ssrContext captured in setup')
  ok(/const ctx = __v23SsrContext/.test(r.code), '$ssrContext read via captured binding')
  ok(/defineEmits\(\[\s*["']save["']\s*,\s*["']done["']\s*\]\)/.test(r.code) ||
    (/defineEmits\(/.test(r.code) && /save/.test(r.code) && /done/.test(r.code)), 'defineEmits event names')
  ok(/onServerPrefetch\(/.test(r.code), 'serverPrefetch → onServerPrefetch')
  ok(/onRenderTracked\(/.test(r.code), 'renderTracked → onRenderTracked')
  ok(/onRenderTriggered\(/.test(r.code), 'renderTriggered → onRenderTriggered')
}

console.log('== edge: $forceUpdate / $destroy child vs root AI note ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      methods: {
        refresh() { this.$forceUpdate() },
        kill() { this.$destroy() },
        killThen(cb) { this.$destroy(); cb && cb() }
      }
    }`
  )
  ok(/__v23Proxy\?\.\$forceUpdate\(\)/.test(r.code), 'forceUpdate via proxy')
  ok(/appContext\.app\.unmount/.test(r.code), 'destroy → app.unmount')
  ok(
    /root-oriented|child|v-if|AI-TODO: \[options-to-composition\] this\.\$destroy/.test(r.code),
    'destroy AI note present for child self-destroy risk'
  )
  // chained call must still rewrite callee, not leave this.$destroy()
  ok(!/this\.\$destroy\s*\(/.test(r.code), 'no leftover this.$destroy()')
  ok(!/this\.\$forceUpdate\s*\(/.test(r.code), 'no leftover this.$forceUpdate()')
}

console.log('== $options.methods → AI-TODO (gone in script setup) ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      methods: {
        readX() { return 1 },
        run() { return this.$options.methods.readX.call({ x: 2 }) }
      }
    }`
  )
  ok(/AI-TODO: \[options-to-composition\] this\.\$options\.methods is undefined in script setup/.test(r.code), 'AI-TODO for $options.methods')
}

console.log('== edge: $data._xxx vs this._xxx (data underscore → ref; internals stay) ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { n: 1, _myFlag: 'custom-ok' } },
      methods: {
        dump() {
          const viaData = this.$data._myFlag
          const viaThis = this._myFlag
          const uid = this._uid
          return { viaData, viaThis, uid }
        }
      }
    }`
  )
  ok(/v23Data/.test(r.code), '$data bag emitted')
  ok(/_myFlag/.test(r.code), '_myFlag kept in output')
  // data _myFlag: this._myFlag → ref binding (align with $data); Vue2 did not proxy it
  ok(/_myFlag\.value/.test(r.code) || /const _myFlag = ref/.test(r.code), 'this._myFlag → data ref')
  ok(!/this\._myFlag/.test(r.code), 'no leftover this._myFlag for data key')
  ok(/this\._uid/.test(r.code), 'this._uid (vue-internal) left as-is')
  ok(/v23Data\._myFlag|get _myFlag\(/.test(r.code), '$data._myFlag → v23Data path')
  ok(/AI-TODO: \[options-to-composition\] data keys \[\_myFlag\]/.test(r.code), 'AI-TODO data underscore')
}

console.log('== edge: this.$watch / $attrs / $slots rewrite ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      inheritAttrs: false,
      data() { return { q: 1 } },
      methods: {
        probe() {
          const stop = this.$watch('q', (nv) => nv)
          const a = this.$attrs.id
          const s = this.$slots.default
          return { stop, a, s }
        }
      }
    }`
  )
  ok(/\bwatch\(/.test(r.code) && !/this\.\$watch/.test(r.code), '$watch → watch()')
  ok(/\battrs\b/.test(r.code) && /useAttrs/.test(r.code) && !/this\.\$attrs/.test(r.code), '$attrs → useAttrs')
  ok(/\bslots\b/.test(r.code) && /useSlots/.test(r.code) && !/this\.\$slots/.test(r.code), '$slots → useSlots')
  ok(/defineOptions\(/.test(r.code) && /inheritAttrs:\s*false/.test(r.code), 'inheritAttrs kept')
}

console.log('== edge: bind/call/apply with local mixin flatten ==')
{
  // Flat local mixins flatten; nested mixins:[mid] where mid itself has mixins is NOT fully inlined
  const flat = migrateOptionsToComposition(
    `const deepMx = {
      data() { return { x: 10 } },
      methods: {
        readX() { return this.x },
        viaCall() {
          if (false) { this.readX.call({ x: 2 }); this.readX.apply({ x: 3 }, []); this.readX.bind({ x: 99 }) }
          return 'marked'
        }
      }
    }
    export default {
      mixins: [deepMx],
      methods: {
        run() {
          if (false) {
            this.readX.bind({ x: 99 })
            this.readX.call({ x: 2 })
            this.readX.apply({ x: 3 }, [])
          }
          return this.viaCall()
        }
      }
    }`
  )
  ok(/function readX\(/.test(flat.code) || /const readX =/.test(flat.code), 'flat mixin method inlined')
  ok(/v23:this-rebinding/.test(flat.code), 'rebinding analysis recorded')
  ok(/"x"\s+in\s+this|in this/.test(flat.code) || /this\.x/.test(flat.code), 'foreign this edge kept')

  const nested = migrateOptionsToComposition(
    `const deepMx = { methods: { readX() { return this.x } } }
    const midMx = { mixins: [deepMx], data() { return { x: 10 } } }
    export default {
      mixins: [midMx],
      methods: {
        run() {
          if (false) { this.readX.call({ x: 2 }) }
          return this.x
        }
      }
    }`
  )
  // same-file nested mixins recurse: deep → mid → host
  ok(/function readX\(/.test(nested.code) || /const readX =/.test(nested.code), 'nested mixin method inlined')
  ok(/ref\(10\)/.test(nested.code) || /x\.value/.test(nested.code), 'nested mixin data inlined')
  ok(/v23:this-rebinding/.test(nested.code), 'rebinding still recorded on nested case')
}

console.log('== edge: imported nested mixin still unresolved AI ==')
{
  const r = migrateOptionsToComposition(
    `import midMx from './mid-mx'
    export default {
      mixins: [midMx],
      data() { return { y: 1 } },
      methods: { go() { return this.y } }
    }`
  )
  ok(/AI-TODO: \[options-to-composition\] kept Options API \(unresolved mixins: midMx\)/.test(r.code), 'import mixin AI')
  ok(/mixins: \[midMx\]/.test(r.code) && !/v23:composition/.test(r.code), 'Options kept')
}

console.log('== edge: provide primitive → ref + inject AI note ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      provide() { return { theme: 'dark', count: 1 } },
      inject: ['theme'],
      methods: { read() { return this.theme } }
    }`
  )
  ok(/provide\(['"]theme['"],\s*ref\(['"]dark['"]\)\)/.test(r.code), 'theme primitive → ref')
  ok(/provide\(['"]count['"],\s*ref\(1\)\)/.test(r.code), 'count primitive → ref')
  ok(/AI-TODO: \[provide-primitive\]/.test(r.code), 'inject-side AI-TODO')
  ok(r.changes.some((c) => c.kind === 'provide-primitive-ref'), 'change recorded')
}

console.log('== data() shorthand + this.prop → IIFE / props (no TDZ) ==')
{
  const r = migrateOptionsToComposition(`
    export default {
      props: { label: { type: String, default: '' }, value: { type: Number, default: 0 } },
      data() {
        const { label: brokenLabel } = this
        return {
          brokenLabel,
          okLabel: this.label,
          shown: this.value,
        }
      },
      methods: { snap() { this.okLabel = this.label } }
    }
  `)
  ok(/__v23DataInit/.test(r.code), 'data IIFE emitted')
  ok(/ref\(__v23DataInit\.brokenLabel\)/.test(r.code), 'brokenLabel from IIFE')
  ok(!/ref\(brokenLabel\)/.test(r.code), 'no TDZ ref(brokenLabel)')
  ok(/=\s*props/.test(r.code) || /\{\s*label:\s*brokenLabel\s*\}\s*=\s*props/.test(r.code), 'destructure from props')
  ok(/defineExpose\(/.test(r.code), 'defineExpose present')
}

console.log('== data key same name as import: no duplicate declaration ==')
{
  const r = migrateOptionsToComposition(`
    import { navItems } from '@/router/index'
    export default {
      data() { return { navItems } },
      computed: { n() { return this.navItems.length } }
    }
  `)
  const decls = r.code.match(/\b(?:const|let|var)\s+navItems\b/g) || []
  ok(decls.length === 0, 'no const navItems redeclaring the import')
  ok(/navItems_1\.value\.length/.test(r.code), 'internal reads use renamed ref')
  ok(r.changes.some((c) => c.kind === 'script-setup-alias-skip'), 'alias skip recorded')
}

console.log('\nAll options-composition tests passed.')

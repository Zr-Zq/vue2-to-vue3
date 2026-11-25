/**
 * Unit tests: Vue2 async factories to defineAsyncComponent
 *   node test/async-component.test.js
 */
const assert = require('assert')
const { migrateAsyncComponent } = require('../src/transform/js-async-component')
const { migrateOptionsToComposition } = require('../src/transform/options-to-composition')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== () => import() to defineAsyncComponent ==')
{
  const r = migrateAsyncComponent(
    `const routes = [{ component: () => import('./Foo.vue') }]`
  )
  ok(/defineAsyncComponent\(\s*\(\)\s*=>\s*import\(/.test(r.code), 'wrapped import factory')
  ok(/from ['"]vue['"]/.test(r.code), 'imports from vue')
  ok(/defineAsyncComponent/.test(r.code), 'defineAsyncComponent import')
  ok(r.changes.some((c) => c.kind === 'async-import-factory'), 'change recorded')
}

console.log('== object factory loading/error/delay ==')
{
  const r = migrateAsyncComponent(`
    const Comp = () => ({
      component: import('./X.vue'),
      loading: Loading,
      error: Err,
      delay: 200,
      timeout: 3000
    })
  `)
  ok(/defineAsyncComponent\(\s*\{/.test(r.code), 'object form')
  ok(/loader\s*:/.test(r.code), 'component to loader')
  ok(/loadingComponent\s*:/.test(r.code), 'loading to loadingComponent')
  ok(/errorComponent\s*:/.test(r.code), 'error to errorComponent')
  ok(/delay\s*:\s*200/.test(r.code), 'delay kept')
  ok(/timeout\s*:\s*3000/.test(r.code), 'timeout kept')
  ok(r.changes.some((c) => c.kind === 'async-options-factory'), 'options factory change')
}

console.log('== Vue.component second arg factory ==')
{
  const r = migrateAsyncComponent(`Vue.component('X', () => import('./X.vue'))`)
  ok(/Vue\.component\(\s*['"]X['"]\s*,\s*defineAsyncComponent/.test(r.code), 'factory wrapped in Vue.component')
}

console.log('== idempotent (already wrapped) ==')
{
  const once = migrateAsyncComponent(`const C = () => import('./A.vue')`)
  const twice = migrateAsyncComponent(once.code)
  const count = (twice.code.match(/defineAsyncComponent/g) || []).length
  // one import + one call (or merged) — must not double-wrap the call
  ok(!/defineAsyncComponent\(\s*defineAsyncComponent/.test(twice.code), 'no double wrap')
  ok(count >= 1, 'still has defineAsyncComponent')
}

console.log('== options composition inlines async component into defineOptions ==')
{
  const r = migrateOptionsToComposition(`
    export default {
      components: {
        Foo: () => import('./Foo.vue')
      },
      data() { return { n: 1 } }
    }
  `)
  ok(!/const Foo\b/.test(r.code), 'no script-setup local (defineOptions cannot reference it)')
  ok(/components:\s*\{\s*Foo:\s*defineAsyncComponent/.test(r.code), 'inlined in defineOptions.components')
  ok(/const n = ref\(1\)/.test(r.code), 'data still to ref')
  ok(r.changes.some((c) => c.kind === 'components-async-inline'), 'async inline change')
}

console.log('== options factory with spread / unknown key: left untouched ==')
{
  const r = migrateAsyncComponent(`
    const opts = { delay: 0 }
    export default {
      components: {
        A: () => ({ component: import('./A.vue'), ...opts }),
        B: () => ({ component: import('./B.vue'), retry: 3 })
      }
    }
  `)
  ok(!/defineAsyncComponent\(/.test(r.code), 'not wrapped (would drop spread / unknown key)')
  ok(/\.\.\.opts/.test(r.code) && /retry: 3/.test(r.code), 'original fields kept')
}

console.log('== component factory referencing module local: const only, not registered ==')
{
  const r = migrateOptionsToComposition(`
    const BarImpl = { name: 'BarImpl', render: () => null }
    export default {
      components: {
        Bar: BarImpl
      },
      data() { return { n: 1 } }
    }
  `)
  ok(/const Bar = BarImpl/.test(r.code), 'kept as const')
  ok(!/defineOptions\([\s\S]*components/.test(r.code), 'not referenced from defineOptions')
}

console.log('== already under defineAsyncComponent: do not re-wrap loader ==')
{
  const src = `
    import { defineAsyncComponent } from 'vue'
    const C = defineAsyncComponent({
      loader: () => import('./X.vue'),
      delay: 200
    })
  `
  const r = migrateAsyncComponent(src)
  ok(/loader:\s*\(\)\s*=>\s*import\(/.test(r.code), 'loader arrow kept')
  ok(!/loader:\s*defineAsyncComponent/.test(r.code), 'loader not wrapped again')
  ok((r.code.match(/defineAsyncComponent\s*\(/g) || []).length === 1, 'single defineAsyncComponent call')
}

console.log('async-component tests passed')

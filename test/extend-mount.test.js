/**
 * Unit tests for Vue.extend / $mount rewrites
 *   node test/extend-mount.test.js
 */
const assert = require('assert')
const { migrateExtend } = require('../src/transform/js-extend')
const { migrateMount } = require('../src/transform/js-mount')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== Vue.extend → defineComponent ==')
{
  const src = "import Vue from 'vue'\nconst C = Vue.extend({ name: 'C', props: ['x'] })\n"
  const r = migrateExtend(src)
  ok(/__v23Extend\(\{ name: 'C'/.test(r.code), 'Vue.extend → __v23Extend')
  ok(/from '@\/compat\/v23-extend'/.test(r.code), 'imports constructable helper')
  ok(!/Vue\.extend/.test(r.code), 'no Vue.extend left')
  ok(!/import Vue from/.test(r.code), 'drops unused Vue default import')
}

console.log('== comment mentioning Vue.extend does not keep the default import ==')
{
  const src = "import Vue from 'vue'\n/** Vue.extend factory */\nconst C = Vue.extend({ name: 'C' })\n"
  const r = migrateExtend(src)
  ok(!/import Vue\b/.test(r.code), 'no default Vue import')
  ok(/__v23Extend\(/.test(r.code), 'still rewritten')
}

console.log('== import Vue, { h } drops Vue when only h remains ==')
{
  const src = "import Vue, { h } from 'vue'\nconst C = Vue.extend({ name: 'C' })\n"
  const r = migrateExtend(src)
  ok(/import \{ h \} from 'vue'/.test(r.code), 'keeps named h')
  ok(!/import Vue\b/.test(r.code), 'no default Vue')
}

console.log('== Base.extend → defineComponent({ extends }) ==')
{
  const src = 'const Sub = Base.extend({ methods: { a() {} } })\n'
  const r = migrateExtend(src)
  ok(/__v23Extend\(\{\s*extends:\s*Base/.test(r.code), 'injects extends: Base')
  ok(!/Base\.extend/.test(r.code), 'no Base.extend left')
}

console.log('== new Vue().$mount → createApp().mount ==')
{
  const src = "new Vue({ render: h => h(App) }).$mount('#app')\n"
  const r = migrateMount(src)
  ok(/createApp\(/.test(r.code), 'createApp')
  ok(/\.mount\(['"]#app['"]\)/.test(r.code), '.mount(#app)')
  ok(!/\$mount/.test(r.code), 'no $mount')
}

console.log('== no-arg $mount ==')
{
  const src = 'new Vue({ data: () => ({}) }).$mount()\n'
  const r = migrateMount(src)
  ok(/\.mount\(document\.createElement\(['"]div['"]\)\)/.test(r.code), 'mount temp div')
}

console.log('== edge: Vue.extend nested + already-imported defineComponent ==')
{
  const src = [
    "import { ref } from 'vue'",
    "import Vue from 'vue'",
    "const Base = Vue.extend({ name: 'Base', methods: { a() { return 1 } } })",
    "const Sub = Base.extend({ methods: { b() { return this.a() + 1 } } })",
    '',
  ].join('\n')
  const r = migrateExtend(src)
  ok(/__v23Extend\(\{ name: 'Base'/.test(r.code), 'outer Vue.extend')
  ok(/__v23Extend\(\{\s*extends:\s*Base/.test(r.code), 'Base.extend → extends: Base')
  ok(/from '@\/compat\/v23-extend'/.test(r.code), 'compat import added')
  ok(!/Vue\.extend|Base\.extend/.test(r.code), 'no .extend left')
}

console.log('== edge: $mount with router/store shorthand + chained vm.$mount ==')
{
  const src = [
    "import Vue from 'vue'",
    "import App from './App.vue'",
    "import router from './router'",
    "import store from './store'",
    "new Vue({ router, store, render: h => h(App) }).$mount('#app')",
    "const vm = new Vue({ data: () => ({ n: 1 }) })",
    "vm.$mount('#sidecar')",
    '',
  ].join('\n')
  const r = migrateMount(src)
  ok(/createApp\(/.test(r.code), 'createApp present')
  ok(/\.use\(router\)/.test(r.code), 'router → .use(router)')
  ok(/\.use\(store\)/.test(r.code), 'store → .use(store)')
  ok(!/createApp\(\{[^}]*\brouter\b/.test(r.code), 'router not left inside createApp options')
  ok(/\.mount\(['"]#app['"]\)/.test(r.code), 'mount #app')
  ok(/\.mount\(['"]#sidecar['"]\)/.test(r.code), 'vm.$mount → .mount')
  ok(!/\$mount/.test(r.code), 'no $mount left')
}

console.log('== edge: router: expr + store shorthand order ==')
{
  const { extractPluginsFromOptions } = require('../src/transform/js-mount')
  const a = extractPluginsFromOptions('{ router, store, render: h => h(App) }')
  ok(a.uses.indexOf('router') !== -1 && a.uses.indexOf('store') !== -1, 'both extracted')
  ok(!/\brouter\b/.test(a.body) && !/\bstore\b/.test(a.body), 'keys stripped from body')
  const b = extractPluginsFromOptions('{ store: myStore, router: myRouter, el: "#x" }')
  ok(b.uses.indexOf('myStore') !== -1 && b.uses.indexOf('myRouter') !== -1, 'long-form values')
}

console.log('== new ExtendCtor() → __v23New, including alias ==')
{
  const src = [
    "import Vue from 'vue'",
    "const Sub = Vue.extend({ name: 'Sub', methods: { fromSub() { return 'extend-ok+sub' } } })",
    'function probe() {',
    '  const Ctor = Sub',
    "  const inst = typeof Ctor === 'function' ? new Ctor() : null",
    '  return inst',
    '}',
    'const direct = new Sub({ propsData: { a: 1 } })',
    'const when = new Date()',
    '',
  ].join('\n')
  const r = migrateExtend(src)
  ok(/__v23New\(Ctor\)/.test(r.code), 'alias new Ctor() → __v23New(Ctor)')
  ok(/__v23New\(Sub, \{ propsData: \{ a: 1 \} \}\)/.test(r.code), 'new Sub(options) keeps the argument')
  ok(/new Date\(\)/.test(r.code), 'new Date() stays')
  ok(!/new Ctor\(/.test(r.code) && !/new Sub\(/.test(r.code), 'extend constructors are not left as new')
  ok(/__v23New/.test(r.code) && /from '@\/compat\/v23-extend'/.test(r.code), 'imports __v23New')
  ok(/typeof Ctor === 'function'/.test(r.code), 'typeof check stays; source shape is not rewritten by hand')
}

console.log('== new Vue() is not an extend call site ==')
{
  const src = "import Vue from 'vue'\nconst vm = new Vue({ data: () => ({ n: 1 }) })\n"
  const r = migrateExtend(src)
  ok(/new Vue\(/.test(r.code), 'new Vue left for migrate-mount')
  ok(!/__v23New/.test(r.code), 'no __v23New')
}

console.log('== imported extend constructor across files ==')
{
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { rewriteExtendCallsInProject } = require('../src/pipeline/plugins/migrate-extend')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-ext-'))
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'src', 'base.js'),
    "import Vue from 'vue'\nexport const EdgeSub = Vue.extend({ name: 'EdgeSub' })\n",
    'utf8'
  )
  fs.writeFileSync(
    path.join(dir, 'src', 'use.js'),
    [
      "import { EdgeSub } from './base'",
      'export function probeExtend() {',
      '  const Ctor = EdgeSub',
      "  const inst = typeof Ctor === 'function' ? new Ctor() : null",
      '  return inst',
      '}',
      '',
    ].join('\n'),
    'utf8'
  )
  const result = rewriteExtendCallsInProject(dir)
  const use = fs.readFileSync(path.join(dir, 'src', 'use.js'), 'utf8')
  const base = fs.readFileSync(path.join(dir, 'src', 'base.js'), 'utf8')
  ok(result.files >= 1, 'project pass rewrote a file')
  ok(/__v23New\(Ctor\)/.test(use), 'imported alias new Ctor() → __v23New')
  ok(/Vue\.extend\(/.test(base), 'factory file is not the fixture workaround')
  ok(/from '@\/compat\/v23-extend'/.test(use), 'call-site file imports the helper')
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('\nextend-mount tests passed')

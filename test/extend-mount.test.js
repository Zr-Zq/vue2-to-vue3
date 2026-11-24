/**
 * Vue.extend / $mount 改写单测
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
  ok(/defineComponent\(\{ name: 'C'/.test(r.code), 'Vue.extend → defineComponent')
  ok(/import \{ defineComponent \}/.test(r.code), 'adds defineComponent import')
  ok(!/Vue\.extend/.test(r.code), 'no Vue.extend left')
}

console.log('== Base.extend → defineComponent({ extends }) ==')
{
  const src = 'const Sub = Base.extend({ methods: { a() {} } })\n'
  const r = migrateExtend(src)
  ok(/defineComponent\(\{\s*extends:\s*Base/.test(r.code), 'injects extends: Base')
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

console.log('== 无参 $mount ==')
{
  const src = 'new Vue({ data: () => ({}) }).$mount()\n'
  const r = migrateMount(src)
  ok(/\.mount\(document\.createElement\(['"]div['"]\)\)/.test(r.code), 'mount temp div')
}

console.log('\nextend-mount tests passed')

/**
 * Standalone render(h) tests (not the full pipeline)
 *
 *   node test/render-h.test.js
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { migrateRenderH } = require('../src/transform/js-render-h')
const { applySfcTransforms } = require('../src/transform/apply-sfc')

function section(name) {
  console.log('\n== ' + name + ' ==')
}

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

section('1) render(h) drop arg + import { h }')
{
  const src = `
export default {
  name: 'Demo',
  render(h) {
    return h('div', { attrs: { id: 'a' }, on: { click: this.onClick } }, ['x'])
  },
}
`
  const r = migrateRenderH(src, 'Demo.js')
  ok(/import\s*\{\s*h\s*\}\s*from\s*['"]vue['"]/.test(r.code), 'has import { h }')
  ok(/render\s*\(\s*\)\s*\{/.test(r.code), 'render() without h param')
  ok(!/render\s*\(\s*h\s*\)/.test(r.code), 'no render(h)')
  ok(/onClick/.test(r.code) || /attrs/.test(r.code), 'h data processed or retained')
  console.log('  changes:', r.changes.map((c) => c.kind).join(', '))
}

section('2) render: (h) => arrow')
{
  const src = `export default { render: (h) => h(App) }`
  const r = migrateRenderH(src, 'main-like.js')
  ok(/render:\s*\(\s*\)\s*=>/.test(r.code) || /render:\s*function\s*\(\s*\)/.test(r.code) || !/render:\s*\(\s*h\s*\)/.test(r.code), 'arrow h stripped')
  ok(/import\s*\{[^}]*\bh\b/.test(r.code), 'import h')
}

section('3) $scopedSlots → $slots')
{
  const src = `
export default {
  render(h) {
    return this.$scopedSlots.body ? this.$scopedSlots.body({ ok: 1 }) : null
  }
}
`
  const r = migrateRenderH(src, 'slots.js')
  ok(/this\.\$slots\.body/.test(r.code), 'scopedSlots renamed')
  ok(!/this\.\$scopedSlots/.test(r.code), 'no scopedSlots left')
}

section('4) real fixture: LcRenderChild.vue')
{
  const file = path.resolve(
    __dirname,
    '../../1.pure-vue-app/src/fixtures/pure-vue2/less-common/LcRenderChild.vue'
  )
  const raw = fs.readFileSync(file, 'utf8')
  const result = applySfcTransforms(raw, file, null, (js) => migrateRenderH(js, file))
  // May already be migrated via --write: 0 changes ok if result is already Vue3 shape
  ok(
    result.changes.length > 0 || /render\s*\(\s*\)\s*\{/.test(raw),
    'fixture changed or already migrated'
  )
  ok(/import\s*\{\s*h\s*\}\s*from\s*['"]vue['"]/.test(result.content), 'vue h import in SFC')
  ok(/render\s*\(\s*\)\s*\{/.test(result.content), 'SFC render()')
  ok(/this\.\$slots\.default/.test(result.content), '$slots.default present')
  ok(!/this\.\$scopedSlots\b/.test(result.content), 'no this.$scopedSlots')
  console.log('  sample changes:', result.changes.slice(0, 6).map((c) => c.kind).join(', ') || '(idempotent)')
}

section('5) EgScopedSlotsProbe.vue')
{
  const file = path.resolve(
    __dirname,
    '../../1.pure-vue-app/src/fixtures/pure-vue2/edge/EgScopedSlotsProbe.vue'
  )
  const raw = fs.readFileSync(file, 'utf8')
  const result = applySfcTransforms(raw, file, null, (js) => migrateRenderH(js, file))
  ok(/render\s*\(\s*\)\s*\{/.test(result.content), 'probe render()')
  ok(!/this\.\$scopedSlots\b/.test(result.content), 'probe no this.$scopedSlots')
}

console.log('\nrender-h tests passed')

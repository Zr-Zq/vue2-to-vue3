/**
 * api-compat / directive-hooks / filters / deep 单测
 *   node test/api-compat.test.js
 */
const assert = require('assert')
const { migrateApiCompat } = require('../src/transform/js-api-compat')
const { migrateDirectiveHooks } = require('../src/transform/js-directive-hooks')
const { migrateFiltersOption } = require('../src/transform/js-filters-option')
const { migrateHtmlFiltersAndListeners, applyFilterChain } = require('../src/transform/html-filters')
const { migrateCssDeep } = require('../src/transform/css-deep')
const { migrateHtmlTemplate } = require('../src/transform/html-directives')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== lifecycle ==')
{
  const r = migrateApiCompat('export default { beforeDestroy() {}, destroyed() {} }')
  ok(/beforeUnmount/.test(r.code), 'beforeDestroy → beforeUnmount')
  ok(/unmounted/.test(r.code), 'destroyed → unmounted')
  ok(!/beforeDestroy|\bdestroyed\b/.test(r.code), 'old hooks gone')
}

console.log('== $set / $delete ==')
{
  const r = migrateApiCompat(
    "export default { methods: { a() { this.$set(this.bag, 'x', 1); this.$delete(this.bag, 'y'); Vue.set(this.arr, 0, 'A'); Vue.delete(this.arr, 1) } } }"
  )
  ok(/this\.bag\.x\s*=\s*1/.test(r.code) || /this\.bag\["x"\]\s*=\s*1/.test(r.code), '$set → assign')
  ok(/delete\s+this\.bag\.y/.test(r.code) || /delete\s+this\.bag\["y"\]/.test(r.code), '$delete → delete')
  ok(/this\.arr\[0\]\s*=\s*'A'/.test(r.code) || /this\.arr\[0\]\s*=\s*"A"/.test(r.code), 'Vue.set index')
  ok(!/\$set|\$delete|Vue\.set|Vue\.delete/.test(r.code), 'no set/delete APIs')
}

console.log('== $listeners / productionTip ==')
{
  const r = migrateApiCompat(
    "export default { computed: { x() { return this.$listeners } }, created() { Vue.config.productionTip = false } }"
  )
  ok(/this\.\$attrs/.test(r.code), '$listeners → $attrs')
  ok(!/productionTip\s*=/.test(r.code), 'productionTip assignment removed')
}

console.log('== directive hooks ==')
{
  const r = migrateDirectiveHooks(
    "export default { directives: { focus: { bind() {}, inserted() {}, update() {}, componentUpdated() {}, unbind() {} } } }"
  )
  ok(/beforeMount/.test(r.code), 'bind → beforeMount')
  ok(/mounted/.test(r.code), 'inserted → mounted')
  ok(/beforeUpdate/.test(r.code), 'update → beforeUpdate')
  ok(/\bupdated\b/.test(r.code), 'componentUpdated → updated')
  ok(/unmounted/.test(r.code), 'unbind → unmounted')
}

console.log('== filters pipe ==')
{
  ok(applyFilterChain("raw | upper").code === 'upper(raw)', 'simple')
  ok(applyFilterChain("price | currency('¥') | upper").code === "upper(currency(price, '¥'))", 'chain+args')
  const h = migrateHtmlFiltersAndListeners(
    '<p>{{ raw | upper }}</p><span :title="t | upper">x</span><Child v-on="$listeners" />'
  )
  ok(/\{\{\s*upper\(raw\)\s*\}\}/.test(h.code), 'mustache')
  ok(/:title="upper\(t\)"/.test(h.code), 'bind filter')
  ok(/v-bind="\$attrs"/.test(h.code), 'v-on listeners → v-bind attrs')
}

console.log('== filters option → methods ==')
{
  const r = migrateFiltersOption(
    "export default { filters: { upper(v) { return v } }, methods: { foo() {} } }"
  )
  ok(/methods\s*:/.test(r.code), 'has methods')
  ok(/upper\s*\(/.test(r.code), 'upper in methods')
  ok(!/filters\s*:/.test(r.code), 'filters gone')
}

console.log('== css deep ==')
{
  const r = migrateCssDeep('.a >>> .b { }\n.c /deep/ .d { }\n.e ::v-deep .f { }\n.g ::v-deep(.h) { }\n.i :deep(.j) { }')
  ok(/::v-deep \.b/.test(r.code), '>>> → ::v-deep')
  ok(/::v-deep \.d/.test(r.code), '/deep/ → ::v-deep')
  ok(/::v-deep \.f/.test(r.code), '::v-deep space kept')
  ok(/::v-deep\(\.h\)/.test(r.code), '::v-deep()')
  ok(/::v-deep\(\.j\)/.test(r.code), ':deep() → ::v-deep()')
}

console.log('== html template integrates filters ==')
{
  const r = migrateHtmlTemplate('<p>{{ a | f }}</p>')
  ok(/f\(a\)/.test(r.code), 'migrateHtmlTemplate includes filters')
}

console.log('\napi-compat tests passed')

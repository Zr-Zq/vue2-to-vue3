/**
 * HTML/JS split + handoff: register filter rewrites; JS consume / skip
 *   node test/handoff-filters.test.js
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { migrateHtmlTemplate } = require('../src/transform/html-directives')
const { migrateFiltersOption } = require('../src/transform/js-filters-option')
const {
  addFiltersHandoff,
  resolveHandoffItem,
  pendingForFile,
  flushHandoff,
  loadHandoff,
  ensureSharedHandoff,
} = require('../src/handoff')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== HTML: |filter to call and collect names ==')
{
  const r = migrateHtmlTemplate('<span :title="a | upper">{{ a | upper }}</span>')
  ok(/upper\(a\)/.test(r.code), 'mustache/bind become upper(a)')
  ok(!/\|\s*upper/.test(r.code), 'no pipe')
  ok(r.filterNames.includes('upper'), 'filterNames includes upper')
}

console.log('== handoff: register to JS rewrite to done ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-handoff-'))
  const project = { root, dryRun: false, shared: {} }
  const file = 'src/Demo.vue'
  addFiltersHandoff(project, file, ['upper'])
  ok(pendingForFile(project, file, 'filters-to-methods').length === 1, 'pending 1')

  const js = [
    'export default {',
    '  filters: { upper(v) { return String(v).toUpperCase() } },',
    '  methods: { ping() {} },',
    '}',
  ].join('\n')
  const mig = migrateFiltersOption(js, 'Demo.vue')
  ok(/methods:\s*\{[\s\S]*upper/.test(mig.code), 'filters merged into methods')
  ok(!/filters\s*:/.test(mig.code), 'filters key removed')

  resolveHandoffItem(project, {
    file,
    kind: 'filters-to-methods',
    status: 'done',
    note: 'ok',
  })
  flushHandoff(project)
  const disk = loadHandoff(root)
  ok(disk.items[0].status === 'done', 'disk handoff status=done')
}

console.log('== handoff: filters not found to skipped ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-handoff-skip-'))
  const project = { root, dryRun: false, shared: {} }
  const file = 'src/Empty.vue'
  addFiltersHandoff(project, file, ['upper'])
  const mig = migrateFiltersOption('export default { methods: { x() {} } }', 'Empty.vue')
  ok(mig.changes.length === 0, 'no filters to JS unchanged')
  resolveHandoffItem(project, {
    file,
    kind: 'filters-to-methods',
    status: 'skipped',
    note: 'JS side: options.filters not found',
  })
  flushHandoff(project)
  const disk = loadHandoff(root)
  ok(disk.items[0].status === 'skipped', 'status=skipped')
  ensureSharedHandoff(project)
  ok(pendingForFile(project, file).length === 0, 'no pending')
}

console.log('== edge: chained filters + attr pipe ==')
{
  const r = migrateHtmlTemplate(
    '<p :title="price | currency | upper">{{ name | trim | upper }}</p>'
  )
  ok(/upper\(currency\(price\)\)/.test(r.code) || /upper\(.*currency/.test(r.code), 'attr chain')
  ok(/upper\(trim\(name\)\)/.test(r.code) || /upper\(.*trim/.test(r.code), 'mustache chain')
  ok(r.filterNames.includes('currency') && r.filterNames.includes('upper'), 'all filter names')
  ok(r.filterNames.includes('trim'), 'trim collected')
}

console.log('== edge: handoff path mismatch to still skip safely ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-handoff-mismatch-'))
  const project = { root, dryRun: false, shared: {} }
  // HTML registered under SFC path
  addFiltersHandoff(project, 'src/Foo.vue', ['upper', 'lower'])
  // JS side opens a different file / no filters option
  const mig = migrateFiltersOption(
    "export default { name: 'Other', methods: { upper() { return 1 } } }",
    'src/Other.vue'
  )
  ok(mig.changes.length === 0, 'wrong file / no filters option to no merge')
  // pending remains for Foo.vue until resolved as skipped
  ok(pendingForFile(project, 'src/Foo.vue', 'filters-to-methods').length === 1, 'Foo still pending')
  resolveHandoffItem(project, {
    file: 'src/Foo.vue',
    kind: 'filters-to-methods',
    status: 'skipped',
    note: 'JS side: options.filters not found (path/options mismatch)',
  })
  flushHandoff(project)
  const disk = loadHandoff(root)
  ok(disk.items.some((i) => i.status === 'skipped'), 'mismatch recorded as skipped')
}

console.log('== edge: filters collide with existing methods name ==')
{
  const mig = migrateFiltersOption(
    [
      'export default {',
      '  filters: { upper(v) { return String(v).toUpperCase() } },',
      '  methods: { upper() { return "method-wins" } },',
      '}',
    ].join('\n'),
    'Collide.vue'
  )
  ok(/methods:\s*\{/.test(mig.code), 'methods block present')
  ok(!/filters\s*:/.test(mig.code), 'filters key removed')
  ok(
    mig.changes.some((c) => c.kind === 'filters-rename-dup' && c.from === 'upper' && c.to === '__v23Filter_upper'),
    'rename-dup change'
  )
  ok(/__v23Filter_upper/.test(mig.code), 'filter kept under alias')
  ok(/method-wins/.test(mig.code), 'methods body kept')
  ok(!/AI-TODO:\s*\[filters\]/.test(mig.code), 'no AI-TODO for handled collision')
  ok(mig.renames.upper === '__v23Filter_upper', 'renames map')
}

console.log('== edge: collide renames mustache/v-bind only, not @click ==')
{
  const { rewriteFilterCallAliases } = require('../src/transform/html-filters')
  const tpl = [
    '<div>',
    '  <p>{{ upper(raw) }}</p>',
    '  <span :title="upper(t)">x</span>',
    '  <button @click="upper()">go</button>',
    '</div>',
  ].join('\n')
  const r = rewriteFilterCallAliases(tpl, { upper: '__v23Filter_upper' })
  ok(/\{\{\s*__v23Filter_upper\(raw\)\s*\}\}/.test(r.code), 'mustache aliased')
  ok(/:title="__v23Filter_upper\(t\)"/.test(r.code), 'v-bind aliased')
  ok(/@click="upper\(\)"/.test(r.code), 'event handler keeps method name')
}

console.log('all handoff-filters tests passed')

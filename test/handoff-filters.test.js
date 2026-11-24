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

console.log('== HTML: |filter → call and collect names ==')
{
  const r = migrateHtmlTemplate('<span :title="a | upper">{{ a | upper }}</span>')
  ok(/upper\(a\)/.test(r.code), 'mustache/bind become upper(a)')
  ok(!/\|\s*upper/.test(r.code), 'no pipe')
  ok(r.filterNames.includes('upper'), 'filterNames includes upper')
}

console.log('== handoff: register → JS rewrite → done ==')
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

console.log('== handoff: filters not found → skipped ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-handoff-skip-'))
  const project = { root, dryRun: false, shared: {} }
  const file = 'src/Empty.vue'
  addFiltersHandoff(project, file, ['upper'])
  const mig = migrateFiltersOption('export default { methods: { x() {} } }', 'Empty.vue')
  ok(mig.changes.length === 0, 'no filters → JS unchanged')
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

console.log('all handoff-filters tests passed')

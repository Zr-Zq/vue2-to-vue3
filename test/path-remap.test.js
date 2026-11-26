/**
 * Path remap unit tests
 *   node test/path-remap.test.js
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  applyMapping,
  normalizeMappings,
  applyPathRemap,
  ensureRemapStub,
} = require('../src/apply-path-remap')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== normalize + applyMapping ==')
{
  const maps = normalizeMappings([
    { from: '@/util', to: '@/utils' },
    { from: '@/util/', to: '@/utils/' },
    { from: '@/axios', to: '@/api/axios', kind: 'exact' },
    { from: '', to: 'x' },
  ])
  ok(maps[0].from.length >= maps[1].from.length, 'longest from first')
  ok(applyMapping('@/util/foo', maps) === '@/utils/foo', 'prefix util/foo')
  ok(applyMapping('@/util', maps) === '@/utils', 'exact util via prefix rule')
  ok(applyMapping('@/axios', maps) === '@/api/axios', 'exact axios')
  ok(applyMapping('@/axios/helper', maps) === null, 'exact does not prefix')
  ok(applyMapping('@/other', maps) === null, 'no match')
}

console.log('== scoped apply on ingest list ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-remap-'))
  const src = path.join(root, 'src')
  fs.mkdirSync(src, { recursive: true })
  const ingested = path.join(src, 'views', 'A.vue')
  const baseOnly = path.join(src, 'main.js')
  fs.mkdirSync(path.dirname(ingested), { recursive: true })
  fs.writeFileSync(
    ingested,
    [
      '<template><div /></template>',
      '<script>',
      "import x from '@/util/x'",
      "import ax from '@/axios'",
      "const y = require('@/util/y')",
      'export default {}',
      '</script>',
    ].join('\n'),
    'utf8'
  )
  fs.writeFileSync(baseOnly, "import keep from '@/util/keep'\n", 'utf8')

  const work = path.join(root, '.v23')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'ingest-files.txt'), 'src/views/A.vue\n', 'utf8')
  fs.writeFileSync(
    path.join(work, 'path-remap.json'),
    JSON.stringify({
      version: 1,
      notes: 'test',
      mappings: [
        { from: '@/util/', to: '@/utils/' },
        { from: '@/util', to: '@/utils' },
        { from: '@/axios', to: '@/api/axios', kind: 'exact' },
      ],
    }),
    'utf8'
  )

  const report = applyPathRemap({ baseRoot: root })
  ok(report.ok, 'apply ok')
  ok(report.changedCount === 1, 'one ingested file changed')
  const after = fs.readFileSync(ingested, 'utf8')
  ok(/from '@\/utils\/x'/.test(after), 'import util→utils')
  ok(/from '@\/api\/axios'/.test(after), 'axios→api/axios')
  ok(/require\('@\/utils\/y'\)/.test(after), 'require remapped')
  const baseAfter = fs.readFileSync(baseOnly, 'utf8')
  ok(/@\/util\/keep/.test(baseAfter), 'base-only file untouched')

  // cleanup
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('== stub does not overwrite ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-stub-'))
  const a = ensureRemapStub(root)
  ok(a.created.length === 2, 'creates json+md')
  fs.writeFileSync(a.jsonPath, '{"version":1,"mappings":[{"from":"@/a","to":"@/b"}]}\n', 'utf8')
  const b = ensureRemapStub(root)
  ok(b.created.length === 0, 'second stub no overwrite')
  const raw = JSON.parse(fs.readFileSync(a.jsonPath, 'utf8'))
  ok(raw.mappings[0].from === '@/a', 'kept AI mappings')
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('== refuses without ingest list ==')
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-noscop-'))
  ensureRemapStub(root)
  fs.writeFileSync(
    path.join(root, '.v23', 'path-remap.json'),
    JSON.stringify({ mappings: [{ from: '@/a', to: '@/b' }] }),
    'utf8'
  )
  const report = applyPathRemap({ baseRoot: root })
  ok(!report.ok, 'fails without scope list')
  ok(/ingest/.test(report.error || ''), 'mentions ingest list')
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\npath-remap tests passed')

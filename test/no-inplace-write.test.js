const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { applyCliWriteMode } = require('../src/pipeline/load-config')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok: ' + msg)
}

console.log('== applyCliWriteMode ==')
{
  const cfg = { dryRun: false }
  applyCliWriteMode(cfg, { write: false })
  ok(cfg.dryRun === true, 'dryRun:false in config does not write without --write')
}
{
  const cfg = { dryRun: true }
  applyCliWriteMode(cfg, { write: true })
  ok(cfg.dryRun === false, '--write forces in-place write')
}
{
  const cfg = { dryRun: false }
  applyCliWriteMode(cfg, { write: false, outDir: 'elsewhere' })
  ok(cfg.dryRun === false, '--out keeps config write mode and does not target sources')
}

function makeFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name))
  fs.mkdirSync(path.join(root, 'src'))
  const src = "export default { created() { return this.$parent } }\n"
  fs.writeFileSync(path.join(root, 'src', 'App.vue'), '<script>\n' + src + '</script>\n', 'utf8')
  fs.writeFileSync(
    path.join(root, 'v23.pipeline.js'),
    'module.exports = { dryRun: false }\n',
    'utf8'
  )
  return root
}

function runCli(script, args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', script), ...args], {
    encoding: 'utf8',
  })
}

console.log('== v23-run / v23-pipeline do not rewrite sources without --write ==')
{
  const root = makeFixture('v23-no-write-')
  const file = path.join(root, 'src', 'App.vue')
  const before = fs.readFileSync(file, 'utf8')
  const pipe = runCli('pipeline.js', [root])
  ok(pipe.status === 0, 'pipeline.js exits 0 (dry-run)')
  ok(fs.readFileSync(file, 'utf8') === before, 'pipeline.js left the source unchanged')
  const run = runCli('run.js', [root, '--keep'])
  ok(run.status === 0, 'run.js exits 0 without --write')
  ok(fs.readFileSync(file, 'utf8') === before, 'run.js left the source unchanged')
  const wrote = runCli('run.js', [root, '--keep', '--write'])
  ok(wrote.status === 0, 'run.js --write exits 0')
  ok(fs.readFileSync(file, 'utf8').indexOf('AI-TODO') !== -1, '--write still inserts AI-TODO')
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('\nno-inplace-write tests passed')

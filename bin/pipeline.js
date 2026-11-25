#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const {
  run,
  createDefaultRegistry,
  loadPipelineConfig,
  applyCliWriteMode,
} = require('../src/pipeline')
const {
  ensureProjectWorkDir,
  projectPipelineReportPath,
  projectWorkDir,
} = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-pipeline <projectRoot> [options]

Pluggable migration pipeline: each file passes through configured plugins;
output of one stage becomes input of the next.

Options:
  --config <file>   Pipeline config (default: project v23.pipeline.js / pipeline.config.js)
  --out <dir>       Rewrite output dir (default dry-run does not write sources)
  --write           Write files in place. Without this flag, sources are not
                    rewritten even if v23.pipeline.js sets dryRun:false.
                    --out still writes only into that directory
  --annotate        All built-in plugins mode=annotate (demo rewrite)
  --list            List built-in plugins and exit
  --order <a,b,c>   Temporarily override pipeline order (comma-separated plugin names)
  --disable <a,b>   Disable plugins
  -h, --help

Analysis artifacts default to <project>/.v23/; use v23-run for the full flow (auto-clean at end).
`)
}

function parseArgs(argv) {
  const args = {
    projectRoot: null,
    configPath: null,
    outDir: null,
    write: false,
    annotate: false,
    list: false,
    order: null,
    disable: [],
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--list') args.list = true
    else if (a === '--write') args.write = true
    else if (a === '--annotate') args.annotate = true
    else if (a === '--config') args.configPath = rest[++i]
    else if (a === '--out') args.outDir = rest[++i]
    else if (a === '--order') args.order = rest[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--disable') args.disable = rest[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (!a.startsWith('-') && !args.projectRoot) args.projectRoot = a
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.list) {
    const reg = createDefaultRegistry()
    console.log('Built-in plugins:')
    reg.list().forEach((p) => console.log(`  - ${p.name}  ${p.description}`))
    process.exit(0)
  }

  if (args.help || !args.projectRoot) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const projectRoot = path.resolve(args.projectRoot)
  if (!fs.existsSync(projectRoot)) {
    console.error('Project not found:', projectRoot)
    process.exit(1)
  }

  // Config: CLI --config first; else in-project; else 2to3/pipeline.config.js
  let configPath = args.configPath
  if (!configPath) {
    const local = ['v23.pipeline.js', 'v23.pipeline.cjs', 'v23.pipeline.json', 'pipeline.config.js']
      .map((n) => path.join(projectRoot, n))
      .find((p) => fs.existsSync(p))
    configPath = local || path.join(__dirname, '..', 'pipeline.config.js')
  }

  const config = loadPipelineConfig(projectRoot, configPath)

  if (args.order && args.order.length) {
    config.pipeline = args.order.map((name) => ({ name, enabled: true }))
  }
  if (args.disable.length) {
    const off = new Set(args.disable)
    config.pipeline = (config.pipeline || []).map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, enabled: !off.has(entry) }
      }
      const name = entry.name || (entry.use && path.basename(entry.use, path.extname(entry.use)))
      if (name && off.has(name)) return Object.assign({}, entry, { enabled: false })
      return entry
    })
  }
  if (args.annotate) {
    config.pipeline = (config.pipeline || []).map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, options: { mode: 'annotate' } }
      }
      return Object.assign({}, entry, {
        options: Object.assign({}, entry.options || {}, { mode: 'annotate' }),
      })
    })
  }
  if (args.outDir) config.outDir = path.resolve(args.outDir)
  applyCliWriteMode(config, { write: args.write, outDir: args.outDir })

  console.log('Pipeline project:', projectRoot)
  console.log('Config:', config.__loadedFrom || configPath)
  console.log(
    'Order:',
    (config.pipeline || [])
      .filter((e) => (typeof e === 'string' ? true : e.enabled !== false))
      .map((e) => (typeof e === 'string' ? e : e.name || e.use))
      .join(' → ')
  )
  console.log('dryRun:', config.dryRun, ' outDir:', config.outDir || '(inplace)')

  const t0 = Date.now()
  const result = await run(projectRoot, { config, verbose: true })
  const ms = Date.now() - t0

  ensureProjectWorkDir(projectRoot)
  const reportPath = projectPipelineReportPath(projectRoot)
  const slim = {
    stages: result.stages,
    stats: result.stats,
    results: result.results.map((r) => ({
      path: r.path,
      changed: r.changed,
      changedBy: r.changedBy,
      aborted: r.aborted,
      reports: r.reports,
    })),
  }
  fs.writeFileSync(reportPath, JSON.stringify(slim, null, 2), 'utf8')

  console.log(
    [
      `Done ${ms}ms`,
      `files=${result.stats.files}`,
      `changed=${result.stats.changed}`,
      `errors=${result.stats.errors}`,
    ].join(' · ')
  )
  console.log('Plugin stats:', JSON.stringify(result.stats.byPlugin))
  console.log('Report (in project):', reportPath)
  console.log('Work dir:', projectWorkDir(projectRoot), '(cleaned when v23-run finishes)')

  // Print summary of files that produced reports
  const withReports = result.results.filter((r) => r.reports && r.reports.length)
  console.log(`Hit files ${withReports.length} (max 25 listed):`)
  withReports.slice(0, 25).forEach((r) => {
    const msg = r.reports.map((x) => x.plugin + ':' + x.message).join(' | ')
    console.log(`  - ${r.path}  ${msg}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

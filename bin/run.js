#!/usr/bin/env node
/**
 * Main flow: analyze (write project .v23) → pipeline → clean .v23
 */
const fs = require('fs')
const path = require('path')
const { writeAnalyze } = require('../src/write-analyze')
const { run, loadPipelineConfig, applyCliWriteMode } = require('../src/pipeline')
const {
  cleanProjectWorkDir,
  cleanOutputRoot,
  projectWorkDir,
  projectPipelineReportPath,
  ensureProjectWorkDir,
  outputPath,
} = require('../src/paths')
const { CANNOT_FULLY_AUTO } = require('../src/pipeline/plugins/risk-summary')

function printHelp() {
  console.log(`Usage: v23-run <projectRoot> [options]

Full flow:
  1. Graph analysis → <project>/.v23/graph.json
  2. Preflight risk pipeline + migration pipeline (both pluggable)
  3. Clean .v23 by default (cannot-fully-auto risk list is printed to console)

Options:
  --keep            Keep .v23 after finish (includes risks.json)
  --write           Write back in place (including risk AI-TODO comments).
                    Without this flag, sources are not rewritten even if
                    v23.pipeline.js sets dryRun:false
  --annotate        Migration plugins mode=annotate (demo rewrite; not the same as AI-TODO)
  --order <a,b,c>   Override migration pipeline order only
  --skip-pipeline   Analyze + clean only
  --clean-only      Only clean project .v23 and repo output
  -h, --help
`)
}

function parseArgs(argv) {
  const args = {
    projectRoot: null,
    keep: false,
    write: false,
    annotate: false,
    skipPipeline: false,
    cleanOnly: false,
    order: null,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--keep') args.keep = true
    else if (a === '--write') args.write = true
    else if (a === '--annotate') args.annotate = true
    else if (a === '--skip-pipeline') args.skipPipeline = true
    else if (a === '--clean-only') args.cleanOnly = true
    else if (a === '--order') args.order = rest[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (!a.startsWith('-') && !args.projectRoot) args.projectRoot = a
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || (!args.projectRoot && !args.cleanOnly)) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  if (args.cleanOnly) {
    const root = args.projectRoot ? path.resolve(args.projectRoot) : null
    if (root) {
      const ok = cleanProjectWorkDir(root)
      console.log(ok ? 'Cleaned ' + projectWorkDir(root) : 'No .v23 to clean: ' + root)
    }
    console.log('Cleaned repo output:', cleanOutputRoot())
    return
  }

  const projectRoot = path.resolve(args.projectRoot)
  if (!fs.existsSync(projectRoot)) {
    console.error('Project not found:', projectRoot)
    process.exit(1)
  }

  console.log('=== 1/3 Preflight analysis →', projectWorkDir(projectRoot))
  const t0 = Date.now()
  const analyzed = writeAnalyze(projectRoot)
  console.log(
    `Analysis done ${Date.now() - t0}ms · graph=${analyzed.graphPath} · files=${analyzed.graph.stats.fileCount}`
  )

  if (!args.skipPipeline) {
    console.log('=== 2/3 Pipeline')
    const config = loadPipelineConfig(projectRoot)
    if (args.order && args.order.length) {
      config.pipeline = args.order.map((name) => ({ name, enabled: true }))
    }
    if (args.annotate) {
      config.pipeline = (config.pipeline || []).map((entry) => {
        if (typeof entry === 'string') return { name: entry, options: { mode: 'annotate' } }
        return Object.assign({}, entry, {
          options: Object.assign({}, entry.options || {}, { mode: 'annotate' }),
        })
      })
    }
    applyCliWriteMode(config, { write: args.write })
    // Graph already built; skip rebuild; keep preflight=false and pass graph
    config.preflight = false

    const t1 = Date.now()
    const result = await run(projectRoot, {
      config,
      graph: analyzed.graph,
    })

    ensureProjectWorkDir(projectRoot)
    const reportPath = projectPipelineReportPath(projectRoot)
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          stages: result.stages,
          stats: result.stats,
          results: result.results.map((r) => ({
            path: r.path,
            changed: r.changed,
            changedBy: r.changedBy,
            reports: r.reports,
          })),
        },
        null,
        2
      ),
      'utf8'
    )
    console.log(
      `Pipeline done ${Date.now() - t1}ms · changed=${result.stats.changed} · report=${reportPath}`
    )

    const risksPath = path.join(projectWorkDir(projectRoot), 'risks.json')
    if (fs.existsSync(risksPath)) {
      const risksDoc = JSON.parse(fs.readFileSync(risksPath, 'utf8'))
      const s = risksDoc.summary || {}
      console.log(
        'Risk summary: total=' +
          s.total +
          ' · yes/partial/no=' +
          (s.byAuto && s.byAuto.yes) +
          '/' +
          (s.byAuto && s.byAuto.partial) +
          '/' +
          (s.byAuto && s.byAuto.no)
      )
      console.log('By category:', JSON.stringify(s.byCategory || {}))
      // Back up to repo output so data survives .v23 cleanup
      const backupDir = outputPath(path.basename(projectRoot) + '-risks')
      fs.mkdirSync(backupDir, { recursive: true })
      fs.copyFileSync(risksPath, path.join(backupDir, 'risks.json'))
      const mdSrc = path.join(projectWorkDir(projectRoot), 'risks-cannot-auto.md')
      if (fs.existsSync(mdSrc)) {
        fs.copyFileSync(mdSrc, path.join(backupDir, 'risks-cannot-auto.md'))
      }
      console.log('Risk report backed up:', backupDir)
    }
  } else {
    console.log('=== 2/3 Pipeline skipped')
  }

  console.log('=== Cannot fully auto-handle (needs manual follow-up) ===')
  CANNOT_FULLY_AUTO.forEach((c, i) => {
    console.log(i + 1 + '. [' + c.category + '] ' + c.title)
    console.log('   ' + c.reason)
  })

  console.log('=== 3/3 Cleanup')
  if (args.keep) {
    console.log('Keeping work dir:', projectWorkDir(projectRoot))
  } else {
    cleanProjectWorkDir(projectRoot)
    console.log('Removed', projectWorkDir(projectRoot))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

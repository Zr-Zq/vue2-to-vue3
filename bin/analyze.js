#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { writeAnalyze } = require('../src/write-analyze')
const { outputPath } = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-analyze <projectRoot> [options]

Preflight analysis; writes to <project>/.v23/ by default (for the pipeline).

Options:
  --out <dir>       Override output directory (default <project>/.v23)
  --copy-report     Also copy to repo output/<project>-analyze
  --json-only       Skip HTML report
  -h, --help
`)
}

function parseArgs(argv) {
  const args = {
    projectRoot: null,
    out: null,
    jsonOnly: false,
    copyReport: false,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--json-only') args.jsonOnly = true
    else if (a === '--copy-report') args.copyReport = true
    else if (a === '--out') args.out = rest[++i]
    else if (!a.startsWith('-') && !args.projectRoot) args.projectRoot = a
  }
  return args
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.projectRoot) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const projectRoot = path.resolve(args.projectRoot)
  if (!fs.existsSync(projectRoot)) {
    console.error('Project directory not found:', projectRoot)
    process.exit(1)
  }

  console.log('Analyzing:', projectRoot)

  // Custom --out still writes to that dir (compat); default is project .v23
  if (args.out) {
    const { buildGraph } = require('../src/build-graph')
    const { renderHtmlReport } = require('../src/report-html')
    const { slimForJson } = require('../src/write-analyze')
    const outDir = path.resolve(args.out)
    fs.mkdirSync(outDir, { recursive: true })
    const t0 = Date.now()
    const graph = slimForJson(buildGraph(projectRoot))
    fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf8')
    if (!args.jsonOnly) {
      fs.writeFileSync(path.join(outDir, 'index.html'), renderHtmlReport(graph), 'utf8')
    }
    console.log(`Done ${Date.now() - t0}ms · wrote ${outDir}`)
    printStats(graph)
    return
  }

  const t0 = Date.now()
  const result = writeAnalyze(projectRoot, {
    html: !args.jsonOnly,
    copyReport: args.copyReport,
  })
  const ms = Date.now() - t0
  console.log(`Done ${ms}ms · work dir ${result.workDir}`)
  console.log('Wrote', result.graphPath)
  if (result.htmlPath) console.log('Wrote', result.htmlPath)
  if (args.copyReport) {
    console.log('Report copy', outputPath(path.basename(projectRoot) + '-analyze'))
  }
  printStats(result.graph)
}

function printStats(graph) {
  const s = graph.stats
  console.log(
    [
      `files=${s.fileCount}`,
      `edges=${s.edgeCount}`,
      `dynamics=${s.dynamicCount}`,
      `globals=${s.globalRegistrationCount}`,
      `mixins=${s.mixinApplicationCount}`,
      `mixinMembers=${s.mixinMemberCount}`,
      `cycles=${s.cycleCount}`,
      `errors=${s.parseErrorCount}`,
    ].join(' · ')
  )

  if (graph.globalIndex && graph.globalIndex.length) {
    console.log('Global registration summary (max 20):')
    graph.globalIndex.slice(0, 20).forEach((g) => {
      const files = g.registrations.map((r) => r.file).join(', ')
      console.log(`  - ${g.api}  ×${g.registrations.length}  @ ${files}`)
    })
  }

  if (graph.mixins && graph.mixins.applications && graph.mixins.applications.length) {
    console.log('Mixin application summary (max 15):')
    graph.mixins.applications.slice(0, 15).forEach((a) => {
      console.log(
        `  - [${a.scope}] ${a.file} to ${a.mixinFile || a.mixinSource || a.localName || '(inline)'}${a.factory ? ' (factory)' : ''}`
      )
    })
  }

  console.log('Tip: use npm run run:demo / v23-run for the full flow (auto-cleans .v23 when done)')
}

main()

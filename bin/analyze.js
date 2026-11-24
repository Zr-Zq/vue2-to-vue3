#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { writeAnalyze } = require('../src/write-analyze')
const { outputPath } = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-analyze <projectRoot> [options]

前置分析，默认写入 <project>/.v23/（供流水线使用）

Options:
  --out <dir>       覆盖输出目录（默认 <project>/.v23）
  --copy-report     额外复制到仓库 output/<项目>-analyze
  --json-only       不写 HTML
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
    console.error('项目目录不存在:', projectRoot)
    process.exit(1)
  }

  console.log('分析中:', projectRoot)

  // 自定义 --out 时仍写到指定目录（兼容）；默认项目内 .v23
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
    console.log(`完成 ${Date.now() - t0}ms · 写出 ${outDir}`)
    printStats(graph)
    return
  }

  const t0 = Date.now()
  const result = writeAnalyze(projectRoot, {
    html: !args.jsonOnly,
    copyReport: args.copyReport,
  })
  const ms = Date.now() - t0
  console.log(`完成 ${ms}ms · 工作目录 ${result.workDir}`)
  console.log('写入', result.graphPath)
  if (result.htmlPath) console.log('写入', result.htmlPath)
  if (args.copyReport) {
    console.log('报告副本', outputPath(path.basename(projectRoot) + '-analyze'))
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
    console.log('全局登记摘要（最多 20）:')
    graph.globalIndex.slice(0, 20).forEach((g) => {
      const files = g.registrations.map((r) => r.file).join(', ')
      console.log(`  - ${g.api}  ×${g.registrations.length}  @ ${files}`)
    })
  }

  if (graph.mixins && graph.mixins.applications && graph.mixins.applications.length) {
    console.log('Mixin 应用摘要（最多 15）:')
    graph.mixins.applications.slice(0, 15).forEach((a) => {
      console.log(
        `  - [${a.scope}] ${a.file} → ${a.mixinFile || a.mixinSource || a.localName || '(inline)'}${a.factory ? ' (factory)' : ''}`
      )
    })
  }

  console.log('提示: 全流程请用 npm run run:demo / v23-run（结束后自动清理 .v23）')
}

main()

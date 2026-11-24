#!/usr/bin/env node
/**
 * 主流程：分析(写入项目 .v23) → 流水线 → 清理 .v23
 */
const fs = require('fs')
const path = require('path')
const { writeAnalyze } = require('../src/write-analyze')
const { run, loadPipelineConfig } = require('../src/pipeline')
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

完整流程：
  1. 图分析 → <project>/.v23/graph.json
  2. 前置风险流水线 + 迁移流水线（均可插拔）
  3. 默认清理 .v23（风险「无法完整自动」清单会打印到控制台）

Options:
  --keep            结束后保留 .v23（含 risks.json）
  --write           写回源码（含风险点 AI-TODO 注释）
  --annotate        迁移插件 mode=annotate（演示改写，不同于 AI-TODO）
  --order <a,b,c>   仅覆盖迁移流水线顺序
  --skip-pipeline   只分析+清理
  --clean-only      只清理项目 .v23 与仓库 output
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
      console.log(ok ? '已清理 ' + projectWorkDir(root) : '无 .v23 可清理: ' + root)
    }
    console.log('已清理仓库 output:', cleanOutputRoot())
    return
  }

  const projectRoot = path.resolve(args.projectRoot)
  if (!fs.existsSync(projectRoot)) {
    console.error('项目不存在:', projectRoot)
    process.exit(1)
  }

  console.log('=== 1/3 前置分析 →', projectWorkDir(projectRoot))
  const t0 = Date.now()
  const analyzed = writeAnalyze(projectRoot)
  console.log(
    `分析完成 ${Date.now() - t0}ms · graph=${analyzed.graphPath} · files=${analyzed.graph.stats.fileCount}`
  )

  if (!args.skipPipeline) {
    console.log('=== 2/3 流水线')
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
    if (args.write) config.dryRun = false
    // 已有 graph，流水线不必再 build；仍走 preflight=false + 传入 graph
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
      `流水线完成 ${Date.now() - t1}ms · changed=${result.stats.changed} · report=${reportPath}`
    )

    const risksPath = path.join(projectWorkDir(projectRoot), 'risks.json')
    if (fs.existsSync(risksPath)) {
      const risksDoc = JSON.parse(fs.readFileSync(risksPath, 'utf8'))
      const s = risksDoc.summary || {}
      console.log(
        '风险汇总: total=' +
          s.total +
          ' · yes/partial/no=' +
          (s.byAuto && s.byAuto.yes) +
          '/' +
          (s.byAuto && s.byAuto.partial) +
          '/' +
          (s.byAuto && s.byAuto.no)
      )
      console.log('按类:', JSON.stringify(s.byCategory || {}))
      // 备份到仓库 output，避免清理 .v23 后丢失
      const backupDir = outputPath(path.basename(projectRoot) + '-risks')
      fs.mkdirSync(backupDir, { recursive: true })
      fs.copyFileSync(risksPath, path.join(backupDir, 'risks.json'))
      const mdSrc = path.join(projectWorkDir(projectRoot), 'risks-cannot-auto.md')
      if (fs.existsSync(mdSrc)) {
        fs.copyFileSync(mdSrc, path.join(backupDir, 'risks-cannot-auto.md'))
      }
      console.log('风险报告已备份:', backupDir)
    }
  } else {
    console.log('=== 2/3 跳过流水线')
  }

  console.log('=== 无法完整自动处理（需你方想办法）===')
  CANNOT_FULLY_AUTO.forEach((c, i) => {
    console.log(i + 1 + '. [' + c.category + '] ' + c.title)
    console.log('   ' + c.reason)
  })

  console.log('=== 3/3 清理')
  if (args.keep) {
    console.log('保留工作目录:', projectWorkDir(projectRoot))
  } else {
    cleanProjectWorkDir(projectRoot)
    console.log('已删除', projectWorkDir(projectRoot))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

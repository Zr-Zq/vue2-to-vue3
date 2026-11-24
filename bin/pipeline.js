#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const {
  run,
  createDefaultRegistry,
  loadPipelineConfig,
} = require('../src/pipeline')
const {
  ensureProjectWorkDir,
  projectPipelineReportPath,
  projectWorkDir,
} = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-pipeline <projectRoot> [options]

可插拔迁移流水线：文件依次通过配置的插件，上一阶段输出 → 下一阶段输入。

Options:
  --config <file>   流水线配置（默认读项目下 v23.pipeline.js / pipeline.config.js）
  --out <dir>       改写输出目录（默认 dry-run 不写源码）
  --write           关闭 dry-run，写出文件
  --annotate        所有内置插件 mode=annotate（演示改写）
  --list            列出内置插件后退出
  --order <a,b,c>   临时覆盖流水线顺序（逗号分隔插件名）
  --disable <a,b>   禁用插件
  -h, --help

分析产物默认读写 <project>/.v23/；全流程请用 v23-run（结束自动清理）。
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
    console.log('内置插件:')
    reg.list().forEach((p) => console.log(`  - ${p.name}  ${p.description}`))
    process.exit(0)
  }

  if (args.help || !args.projectRoot) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const projectRoot = path.resolve(args.projectRoot)
  if (!fs.existsSync(projectRoot)) {
    console.error('项目不存在:', projectRoot)
    process.exit(1)
  }

  // 配置：优先 CLI --config；否则项目内；再回退到 2to3/pipeline.config.js
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
  if (args.write) config.dryRun = false
  if (args.outDir) config.outDir = path.resolve(args.outDir)

  console.log('流水线项目:', projectRoot)
  console.log('配置:', config.__loadedFrom || configPath)
  console.log(
    '顺序:',
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
      `完成 ${ms}ms`,
      `files=${result.stats.files}`,
      `changed=${result.stats.changed}`,
      `errors=${result.stats.errors}`,
    ].join(' · ')
  )
  console.log('插件统计:', JSON.stringify(result.stats.byPlugin))
  console.log('报告(项目内):', reportPath)
  console.log('工作目录:', projectWorkDir(projectRoot), '（v23-run 结束会清理）')

  // 打印有报告的文件摘要
  const withReports = result.results.filter((r) => r.reports && r.reports.length)
  console.log(`命中文件 ${withReports.length}（最多列 25）:`)
  withReports.slice(0, 25).forEach((r) => {
    const msg = r.reports.map((x) => x.plugin + ':' + x.message).join(' | ')
    console.log(`  - ${r.path}  ${msg}`)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

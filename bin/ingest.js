#!/usr/bin/env node
/**
 * 将待迁移源文件摄入 AI 底座工程，并按底座路径配置重写 import
 *
 *   node bin/ingest.js --from <源文件|目录> --to <底座内目标路径> [--base <底座根>] [--source-root <源根>] [--dry-run]
 */
const fs = require('fs')
const path = require('path')
const { ingestFiles } = require('../src/ingest')

function printHelp() {
  console.log(`Usage: v23-ingest --from <path> --to <path> [options]

把业务源码拷进迁移底座，并按底座的 jsconfig/webpack alias 自动改写引入路径。

Required:
  --from <path>         源文件或目录（Vue2 业务工程内）
  --to <path>           输出路径：单文件目标，或目录（from 为目录时）

Options:
  --base <dir>          底座项目根（默认从 --to 向上自动检测）
  --source-root <dir>   源工程根（默认从 --from 向上自动检测）
  --dry-run             只打印改写结果，不写盘
  --no-backup           覆盖已存在文件时不备份（默认会备份到 <base>/.v23/backup/）
  -h, --help

Examples:
  v23-ingest --from D:/app/src/views/Foo.vue --to D:/migrate-base/src/views/Foo.vue
  v23-ingest --from D:/app/src/views/user --to D:/migrate-base/src/views/user --base D:/migrate-base
`)
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    base: null,
    sourceRoot: null,
    dryRun: false,
    backup: true,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--no-backup') args.backup = false
    else if (a === '--from') args.from = rest[++i]
    else if (a === '--to') args.to = rest[++i]
    else if (a === '--base') args.base = rest[++i]
    else if (a === '--source-root') args.sourceRoot = rest[++i]
  }
  return args
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.from || !args.to) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const result = ingestFiles({
    from: args.from,
    to: args.to,
    baseRoot: args.base,
    sourceRoot: args.sourceRoot,
    dryRun: args.dryRun,
    backup: args.backup,
  })

  console.log('源工程根:', result.sourceRoot)
  console.log('底座根:', result.baseRoot)
  if (result.backedUpCount) {
    console.log('已备份覆盖文件:', result.backedUpCount, '→', result.backupDir)
  }
  console.log(
    '底座 alias:',
    Object.keys(result.baseAlias)
      .map((k) => k + '→' + result.baseAlias[k])
      .join(', ')
  )
  console.log('dryRun:', result.dryRun)
  console.log('文件数:', result.files.length)

  result.files.forEach((f) => {
    console.log(`  ${f.from}  →  ${f.to}`)
    ;(f.changes || [])
      .filter((c) => c.to)
      .forEach((c) => {
        console.log(`    import "${c.from}" → "${c.to}" (${c.reason})`)
      })
    ;(f.changes || [])
      .filter((c) => !c.to && c.reason !== 'alias-passthrough')
      .slice(0, 5)
      .forEach((c) => {
        console.log(`    未改写 "${c.from}" [${c.reason}]`)
      })
  })

  const reportDir = path.join(result.baseRoot, '.v23')
  fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'ingest-report.json')
  if (!args.dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8')
    console.log('报告:', reportPath)
  }
}

main()

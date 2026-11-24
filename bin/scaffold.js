#!/usr/bin/env node
/**
 * 拷贝迁移底座（默认 1.pure-vue-app）到目标目录，供 AI 迁移工作区使用
 */
const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-scaffold --to <dir> [--from <底座模板>]

拷贝纯 Vue 迁移底座到新目录（第一步）。

Options:
  --to <dir>     目标目录（将创建/覆盖拷贝）
  --from <dir>   模板路径（默认仓库内 1.pure-vue-app）
  -h, --help
`)
}

function parseArgs(argv) {
  const args = { to: null, from: null }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--to') args.to = rest[++i]
    else if (a === '--from') args.from = rest[++i]
  }
  return args
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  entries.forEach((ent) => {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.v23') return
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  })
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.to) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }
  const from = path.resolve(args.from || path.join(REPO_ROOT, '1.pure-vue-app'))
  const to = path.resolve(args.to)
  if (!fs.existsSync(from)) {
    console.error('底座模板不存在:', from)
    process.exit(1)
  }
  copyDir(from, to)
  console.log('已拷贝底座:')
  console.log('  from:', from)
  console.log('  to:  ', to)
  console.log('下一步: 在目标目录 npm install，再用 v23-ingest 导入业务文件')
}

main()

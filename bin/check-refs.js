#!/usr/bin/env node
/**
 * 迁移收尾：调用本仓库 scripts/check-import-refs.mjs，整理缺失引用给 AI 确认。
 * 不依赖、不修改用户全局 skill。
 *
 *   node bin/check-refs.js <底座根> [--files-from <list>] [--all]
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const fg = require('fast-glob')
const { detectProjectRoot } = require('../src/detect-root')
const { ensureProjectWorkDir, projectWorkDir } = require('../src/paths')
const { toPosixRel } = require('../src/resolve')

const DEFAULT_CHECKER = path.join(__dirname, '..', 'scripts', 'check-import-refs.mjs')

function printHelp() {
  console.log(`Usage: v23-check-refs <projectRoot> [options]

迁移全部功能完成后的必要检查：查找缺失本地引用，交给 AI 确认。
底层脚本（仓库内）：2to3/scripts/check-import-refs.mjs
格式说明：2to3/docs/missing-refs-format.md

Options:
  --files-from <file>  只检查清单内文件（默认用 .v23/ingest-files.txt）
  --all                检查整个 src
  --checker <path>     覆盖检测脚本路径（默认用仓库内副本）
  -h, --help
`)
}

function parseArgs(argv) {
  const args = {
    root: null,
    filesFrom: null,
    all: false,
    checker: DEFAULT_CHECKER,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--all') args.all = true
    else if (a === '--files-from') args.filesFrom = rest[++i]
    else if (a === '--checker') args.checker = rest[++i]
    else if (!a.startsWith('-') && !args.root) args.root = a
  }
  return args
}

function buildFilesFromIngest(root) {
  const listPath = path.join(projectWorkDir(root), 'ingest-files.txt')
  if (fs.existsSync(listPath) && fs.readFileSync(listPath, 'utf8').trim()) return listPath

  const reportPath = path.join(projectWorkDir(root), 'ingest-report.json')
  if (!fs.existsSync(reportPath)) return null
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    const files = (report.files || []).map((f) => f.to).filter(Boolean)
    if (!files.length) return null
    fs.writeFileSync(listPath, files.join('\n') + '\n', 'utf8')
    return listPath
  } catch (e) {
    return null
  }
}

function normalizeMissing(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload.map(normalizeItem)
  if (Array.isArray(payload.missing)) return payload.missing.map(normalizeItem)
  return []
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return { raw: item }
  return {
    file: item.file || item['引用文件'] || item.from || item.importer || null,
    line: item.line || item['行号'] || (item.loc && item.loc.line) || null,
    specifier: item.specifier || item['导入语句'] || item.import || item.request || null,
    missing: item.missing || item['缺失路径'] || item.missingPath || item.target || null,
    project: item.project || item['项目'] || null,
    raw: item,
  }
}

function formatForAi(root, missing) {
  const lines = []
  lines.push('# 缺失引用（请 AI 确认）')
  lines.push('')
  lines.push('- 项目: `' + root + '`')
  lines.push('- 共 ' + missing.length + ' 条')
  lines.push('- 字段说明见: `2to3/docs/missing-refs-format.md`')
  lines.push('')
  lines.push('请逐条确认：补文件 / 改 import / 或标记为可忽略（npm 包误报等）。')
  lines.push('')
  missing.forEach((item, i) => {
    lines.push((i + 1) + '. `' + (item.file || '?') + ':' + (item.line || '?') + '`')
    lines.push('   - 导入: `' + (item.specifier || '?') + '`')
    if (item.missing) lines.push('   - 缺失路径: `' + item.missing + '`')
    if (item.project) lines.push('   - 子项目: ' + item.project)
    lines.push('')
  })
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.root) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  let root = path.resolve(args.root)
  const detected = detectProjectRoot(root)
  if (detected) root = detected

  const checker = path.resolve(args.checker)
  if (!fs.existsSync(checker)) {
    console.error('找不到检测脚本:', checker)
    process.exit(2)
  }

  ensureProjectWorkDir(root)

  let filesFrom = args.filesFrom
  if (!args.all && !filesFrom) {
    filesFrom = buildFilesFromIngest(root)
  }
  if (args.all && !args.filesFrom) {
    const allFiles = fg.sync(['src/**/*.{vue,js,jsx,ts,tsx,mjs,cjs}'], {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.v23/**'],
    })
    const listPath = path.join(projectWorkDir(root), 'all-src-files.txt')
    fs.writeFileSync(
      listPath,
      allFiles.map((f) => toPosixRel(f, root)).join('\n') + '\n',
      'utf8'
    )
    filesFrom = listPath
  }

  const cmdArgs = [checker, root, '--json']
  if (filesFrom) {
    cmdArgs.push('--files-from', path.resolve(filesFrom))
    console.log('检查范围: files-from', filesFrom)
  } else {
    console.log('检查范围: 脚本默认（多为 git 改动）；建议加 --all 或先 ingest')
  }

  console.log('运行本地脚本:', checker)
  const res = spawnSync(process.execPath, cmdArgs, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  const stdout = (res.stdout || '').trim()
  const stderr = (res.stderr || '').trim()
  if (stderr) console.error(stderr)

  const work = projectWorkDir(root)
  fs.writeFileSync(path.join(work, 'missing-refs.raw.txt'), stdout + (stderr ? '\n' + stderr : ''), 'utf8')

  let payload = null
  try {
    const jsonStart = stdout.indexOf('{')
    const jsonArr = stdout.indexOf('[')
    const start =
      jsonStart === -1
        ? jsonArr
        : jsonArr === -1
          ? jsonStart
          : Math.min(jsonStart, jsonArr)
    payload = start >= 0 ? JSON.parse(stdout.slice(start)) : null
  } catch (e) {
    payload = null
  }

  const missing = normalizeMissing(payload)
  const passed =
    res.status === 0 &&
    (stdout === 'true' ||
      /(?:^|\n)true\s*$/.test(stdout) ||
      (payload && payload.ok === true && missing.length === 0) ||
      (payload && Array.isArray(payload.missing) && payload.missing.length === 0 && res.status === 0))

  if (passed) {
    const okDoc = {
      ok: true,
      projectRoot: root,
      totalMissing: 0,
      missing: [],
      checkedAt: new Date().toISOString(),
      checker,
    }
    fs.writeFileSync(path.join(work, 'missing-refs.json'), JSON.stringify(okDoc, null, 2), 'utf8')
    fs.writeFileSync(
      path.join(work, 'missing-refs-for-ai.md'),
      '# 缺失引用（请 AI 确认）\n\n无缺失，检查通过。\n',
      'utf8'
    )
    console.log('缺失引用检查: 通过')
    console.log('报告:', path.join(work, 'missing-refs.json'))
    process.exit(0)
  }

  const doc = {
    ok: false,
    projectRoot: root,
    totalMissing: missing.length,
    missing,
    raw: payload || { stdout },
    checkedAt: new Date().toISOString(),
    hint: '请 AI 逐条确认：补文件 / 改 import / 或忽略误报',
    formatDoc: '2to3/docs/missing-refs-format.md',
    checker,
    checkerExit: res.status,
  }

  const jsonOut = path.join(work, 'missing-refs.json')
  const mdOut = path.join(work, 'missing-refs-for-ai.md')
  fs.writeFileSync(jsonOut, JSON.stringify(doc, null, 2), 'utf8')
  fs.writeFileSync(mdOut, formatForAi(root, missing), 'utf8')

  console.log('缺失引用检查: 未通过 · ' + missing.length + ' 条')
  missing.slice(0, 30).forEach((item, i) => {
    console.log(
      (i + 1) +
        '. ' +
        (item.file || '?') +
        ':' +
        (item.line || '?') +
        '  →  ' +
        (item.specifier || '?') +
        (item.missing ? '  (缺 ' + item.missing + ')' : '')
    )
  })
  if (missing.length > 30) console.log('... 其余见报告')
  console.log('AI 确认清单:', mdOut)
  console.log('JSON:', jsonOut)
  process.exit(1)
}

main()

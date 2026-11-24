#!/usr/bin/env node
/**
 * Migration wrap-up: run this repo's scripts/check-import-refs.mjs and
 * format missing refs for AI review. Does not use or modify the user's global skill.
 *
 *   node bin/check-refs.js <baseRoot> [--files-from <list>] [--all]
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

Required check after migration features are done: find missing local refs for AI to confirm.
Checker (in-repo): 2to3/scripts/check-import-refs.mjs
Format docs: 2to3/docs/missing-refs-format.md

Options:
  --files-from <file>  Check only listed files (default: .v23/ingest-files.txt)
  --all                Check entire src
  --checker <path>     Override checker script (default: in-repo copy)
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
    // Chinese keys kept for backward compat with older checker JSON
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
  lines.push('# Missing refs (for AI review)')
  lines.push('')
  lines.push('- Project: `' + root + '`')
  lines.push('- Total: ' + missing.length)
  lines.push('- Field docs: `2to3/docs/missing-refs-format.md`')
  lines.push('')
  lines.push('Confirm each: add file / fix import / or mark ignorable (false npm-package hit, etc.).')
  lines.push('')
  missing.forEach((item, i) => {
    lines.push((i + 1) + '. `' + (item.file || '?') + ':' + (item.line || '?') + '`')
    lines.push('   - Import: `' + (item.specifier || '?') + '`')
    if (item.missing) lines.push('   - Missing path: `' + item.missing + '`')
    if (item.project) lines.push('   - Subproject: ' + item.project)
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
    console.error('Checker script not found:', checker)
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
    console.log('Scope: files-from', filesFrom)
  } else {
    console.log('Scope: checker default (mostly git changes); prefer --all or ingest first')
  }

  console.log('Running local checker:', checker)
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
      '# Missing refs (for AI review)\n\nNone missing; check passed.\n',
      'utf8'
    )
    console.log('Missing-refs check: passed')
    console.log('Report:', path.join(work, 'missing-refs.json'))
    process.exit(0)
  }

  const doc = {
    ok: false,
    projectRoot: root,
    totalMissing: missing.length,
    missing,
    raw: payload || { stdout },
    checkedAt: new Date().toISOString(),
    hint: 'Ask AI to confirm each: add file / fix import / or ignore false positives',
    formatDoc: '2to3/docs/missing-refs-format.md',
    checker,
    checkerExit: res.status,
  }

  const jsonOut = path.join(work, 'missing-refs.json')
  const mdOut = path.join(work, 'missing-refs-for-ai.md')
  fs.writeFileSync(jsonOut, JSON.stringify(doc, null, 2), 'utf8')
  fs.writeFileSync(mdOut, formatForAi(root, missing), 'utf8')

  console.log('Missing-refs check: failed · ' + missing.length + ' item(s)')
  missing.slice(0, 30).forEach((item, i) => {
    console.log(
      (i + 1) +
        '. ' +
        (item.file || '?') +
        ':' +
        (item.line || '?') +
        '  →  ' +
        (item.specifier || '?') +
        (item.missing ? '  (missing ' + item.missing + ')' : '')
    )
  })
  if (missing.length > 30) console.log('... see report for the rest')
  console.log('AI review list:', mdOut)
  console.log('JSON:', jsonOut)
  process.exit(1)
}

main()

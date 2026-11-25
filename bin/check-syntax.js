#!/usr/bin/env node
/**
 * Migration wrap-up: syntax check (JSON, bindings, JS/TS/Vue script).
 *
 *   node bin/check-syntax.js <baseRoot> [--files-from <list>] [--all]
 */
const fs = require('fs')
const path = require('path')
const { detectProjectRoot } = require('../src/detect-root')
const { ensureProjectWorkDir, projectWorkDir } = require('../src/paths')
const { checkProject } = require('../scripts/check-syntax')

function printHelp() {
  console.log(`Usage: v23-check-syntax <projectRoot> [options]

After migration, check JSON and JS/TS/Vue script syntax (including declaration / identifier errors).
Checker: 2to3/scripts/check-syntax.js
Format docs: 2to3/docs/en/syntax-check-format.md

Options:
  --files-from <file>  Check only listed files
  --all                Check src, root JSON, and sidecar dirs (default)
  -h, --help
`)
}

function parseArgs(argv) {
  const args = { root: null, filesFrom: null, all: false }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--all') args.all = true
    else if (a === '--files-from') args.filesFrom = rest[++i]
    else if (!a.startsWith('-') && !args.root) args.root = a
  }
  return args
}

function formatForAi(root, issues) {
  const lines = []
  lines.push('# Syntax issues (for AI review)')
  lines.push('')
  lines.push('- Project: `' + root + '`')
  lines.push('- Total: ' + issues.length)
  lines.push('- Field docs: `2to3/docs/en/syntax-check-format.md`')
  lines.push('')
  lines.push('Fix the migrated code. Do not change the source project or fixtures to hide the error.')
  lines.push('')
  issues.forEach((item, i) => {
    lines.push(i + 1 + '. `' + item.file + ':' + item.line + '`')
    lines.push('   - Kind: `' + item.kind + '`')
    lines.push('   - ' + item.message)
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

  ensureProjectWorkDir(root)
  const report = checkProject(root, { filesFrom: args.filesFrom || null })
  const work = projectWorkDir(root)
  const jsonOut = path.join(work, 'syntax-issues.json')
  const mdOut = path.join(work, 'syntax-issues-for-ai.md')
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8')

  if (report.ok) {
    fs.writeFileSync(
      mdOut,
      '# Syntax issues (for AI review)\n\nNo JSON or script syntax issues.\n',
      'utf8'
    )
    console.log('Syntax check: passed')
    console.log('Report:', jsonOut)
    process.exit(0)
  }

  fs.writeFileSync(mdOut, formatForAi(root, report.issues), 'utf8')
  console.log('Syntax check: failed · ' + report.issues.length + ' issue(s)')
  report.issues.slice(0, 30).forEach((item, i) => {
    console.log(i + 1 + '. ' + item.file + ':' + item.line + ' [' + item.kind + '] ' + item.message)
  })
  if (report.issues.length > 30) console.log('... see report for the rest')
  console.log('AI review list:', mdOut)
  console.log('JSON:', jsonOut)
  process.exit(1)
}

main()

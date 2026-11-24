#!/usr/bin/env node
/**
 * Ingest source files into the AI migration base and rewrite imports
 * to match the base project's path aliases.
 *
 *   node bin/ingest.js --from <srcFile|dir> --to <baseTargetPath> [--base <baseRoot>] [--source-root <srcRoot>] [--dry-run]
 */
const fs = require('fs')
const path = require('path')
const { ingestFiles } = require('../src/ingest')

function printHelp() {
  console.log(`Usage: v23-ingest --from <path> --to <path> [options]

Copy business source into the migration base and rewrite imports using
the base project's jsconfig/webpack aliases.

Required:
  --from <path>         Source file or directory (Vue2 app)
  --to <path>           Output path: single-file target, or directory (when --from is a dir)

Options:
  --base <dir>          Base project root (default: auto-detect upward from --to)
  --source-root <dir>   Source project root (default: auto-detect upward from --from)
  --dry-run             Print rewrite results only; do not write
  --no-backup           Do not back up existing files on overwrite (default: <base>/.v23/backup/)
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

  console.log('Source root:', result.sourceRoot)
  console.log('Base root:', result.baseRoot)
  if (result.backedUpCount) {
    console.log('Backed up overwritten files:', result.backedUpCount, '→', result.backupDir)
  }
  console.log(
    'Base aliases:',
    Object.keys(result.baseAlias)
      .map((k) => k + '→' + result.baseAlias[k])
      .join(', ')
  )
  console.log('dryRun:', result.dryRun)
  console.log('Files:', result.files.length)

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
        console.log(`    unchanged "${c.from}" [${c.reason}]`)
      })
  })

  const reportDir = path.join(result.baseRoot, '.v23')
  fs.mkdirSync(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, 'ingest-report.json')
  if (!args.dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8')
    console.log('Report:', reportPath)
  }
}

main()

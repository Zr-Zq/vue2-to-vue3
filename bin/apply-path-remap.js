#!/usr/bin/env node
/**
 * Apply AI path remaps to ingested files only.
 *
 *   node bin/apply-path-remap.js <baseRoot> [--dry-run] [--files-from list] [--remap path.json] [--stub]
 */
const path = require('path')
const { applyPathRemap, ensureRemapStub } = require('../src/apply-path-remap')

function printHelp() {
  console.log(`Usage: v23-apply-path-remap <baseRoot> [options]

Rewrite import/require/dynamic-import strings using <.v23/path-remap.json>,
but ONLY in files listed by .v23/ingest-files.txt (this migrate/copy batch).

AI writes:
  .v23/path-remap.md    human/AI comparison table (temporary)
  .v23/path-remap.json  machine mappings { from, to, kind? }

Options:
  --dry-run             Do not write files; still emit path-remap-report.json
  --files-from <file>   Override ingest list (default .v23/ingest-files.txt)
  --remap <file>        Override path-remap.json
  --stub                Create empty path-remap.json + .md if missing, then exit
  -h, --help
`)
}

function parseArgs(argv) {
  const args = {
    root: null,
    dryRun: false,
    filesFrom: null,
    remap: null,
    stub: false,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--stub') args.stub = true
    else if (a === '--files-from') args.filesFrom = rest[++i]
    else if (a === '--remap') args.remap = rest[++i]
    else if (!a.startsWith('-') && !args.root) args.root = a
  }
  return args
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.root) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }
  const root = path.resolve(args.root)
  if (args.stub) {
    const stub = ensureRemapStub(root)
    console.log('Stub ready:')
    console.log(' ', stub.jsonPath)
    console.log(' ', stub.mdPath)
    if (stub.created.length) console.log('Created:', stub.created.length)
    else console.log('Already present (not overwritten)')
    process.exit(0)
  }

  const report = applyPathRemap({
    baseRoot: root,
    filesFrom: args.filesFrom,
    remapPath: args.remap,
    dryRun: args.dryRun,
  })

  if (!report.ok) {
    console.error('path-remap failed:', report.error)
    process.exit(1)
  }
  if (report.skipped) {
    console.log('path-remap skipped:', report.reason)
    process.exit(0)
  }

  console.log(
    'path-remap:',
    report.changedCount,
    'file(s) changed,',
    'scoped',
    report.scopedFileCount,
    args.dryRun ? '(dry-run)' : ''
  )
  report.files.forEach((f) => {
    if (!f.changes || !f.changes.length) return
    console.log(' ', f.file)
    f.changes.forEach((c) => console.log('   ', c.from, '→', c.to))
  })
  if (report.reportPath) console.log('Report:', report.reportPath)
}

main()

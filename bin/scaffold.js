#!/usr/bin/env node
/**
 * Legacy: copy the in-repo Vue2 template (default 1.pure-vue-app) to --to.
 * Real migrations: AI builds a Vite+Vue3 base (incl. env/project config) instead.
 * Scripts must never migrate .env* / VUE_APP_* ↔ VITE_*.
 */
const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../src/paths')

function printHelp() {
  console.log(`Usage: v23-scaffold --to <dir> [--from <baseTemplate>]

Legacy template copy only. Prefer AI creating a Vite+Vue3 base at --to.

Options:
  --to <dir>     Target directory (created / overwrite-copied into)
  --from <dir>   Template path (default: repo 1.pure-vue-app)
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
    console.error('Base template not found:', from)
    process.exit(1)
  }
  copyDir(from, to)
  console.log('Copied base:')
  console.log('  from:', from)
  console.log('  to:  ', to)
  console.log('Next: npm install in the target, then v23-ingest to import business files')
}

main()

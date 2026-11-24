#!/usr/bin/env node
/**
 * Migration entry point (script side)
 *
 * Intended usage:
 *   --from  Source project root being migrated
 *   --src   Directory inside source (relative to from, default src)
 *   --to    Migration target root (base project)
 *
 * Stages:
 *   1 analyze   Analyze source → <from>/.v23 and reports
 *   2 scaffold  Legacy only — real runs: AI builds Vite+Vue3 base (env + project config; scripts never touch env)
 *   3 copy      Copy by relative path into --to; backup then overwrite if exists
 *   4 pipeline  Deterministic syntax migration + AI-TODO (no env / project-config transforms)
 *   5 todos     Emit AI todo list (script pauses here for AI)
 *   6 check     After AI edits: missing-refs check
 *   7 pipeline  May re-run --step pipeline for another round
 *
 *   --step script  = analyze + copy + pipeline + todos (default; no scaffold)
 *   --step all     = same as script if base exists; otherwise hand off for AI Vue3 base
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { REPO_ROOT, ensureProjectWorkDir, projectWorkDir } = require('../src/paths')
const { writeAnalyze } = require('../src/write-analyze')
const { ingestFiles } = require('../src/ingest')
const {
  listSidecarDirs,
  isNeverCopyDir,
  sidecarCopyIgnoreGlobs,
} = require('../src/sidecar-dirs')
const { ensureBackupBatch, backupIfExists } = require('../src/backup')

const BIN = __dirname

function printHelp() {
  console.log(`Usage: v23-migrate --from <sourceRoot> --to <targetRoot> [options]

Workflow:
  Analyze source → (AI builds base) → copy (backup then overwrite) → pipeline auto-fix + AI-TODO
  → [PAUSE] AI edits markers → check-refs → may re-run pipeline

Required:
  --from <dir>          Vue2 source project root
  --to <dir>            Target root (base project)

Options:
  --src <rel>           Source dir relative to --from (default src)
  --dest-src <rel>      Target dir relative to --to (default same as --src)
  --step <name>         analyze|scaffold|copy|pipeline|todos|check|script|all
                        default script (analyze+copy+pipeline+todos)
  --scaffold            (discouraged) Copy legacy template if target has no project; prefer AI Vue3 base
  --force-scaffold      Force overwrite-copy of the template base (use with care)
  --template <dir>      Legacy template (default repo 1.pure-vue-app)
  --no-backup           Do not back up existing files on copy
  --dry-run             Copy dry-run only
  -h, --help

Examples:
  # After AI created a Vite+Vue3 base (incl. env) at --to:
  v23-migrate --from D:/old-app --src src --to D:/new-app
  v23-migrate --from D:/old-app --to D:/new-app --step analyze
  # After AI finishes AI-TODO items:
  v23-migrate --to D:/new-app --step check
  v23-migrate --to D:/new-app --step pipeline
`)
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    src: 'src',
    destSrc: null,
    step: 'script',
    scaffold: false,
    forceScaffold: false,
    template: null,
    backup: true,
    dryRun: false,
  }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--from') args.from = rest[++i]
    else if (a === '--to') args.to = rest[++i]
    else if (a === '--src') args.src = rest[++i]
    else if (a === '--dest-src') args.destSrc = rest[++i]
    else if (a === '--step') args.step = rest[++i]
    else if (a === '--scaffold') args.scaffold = true
    else if (a === '--force-scaffold') args.forceScaffold = true
    else if (a === '--template') args.template = rest[++i]
    else if (a === '--no-backup') args.backup = false
    else if (a === '--dry-run') args.dryRun = true
  }
  if (!args.destSrc) args.destSrc = args.src
  return args
}

function runNode(script, argv, label) {
  console.log('\n>>>', label)
  const res = spawnSync(process.execPath, [path.join(BIN, script), ...argv], {
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (res.status !== 0) {
    throw new Error(label + ' failed, exit=' + res.status)
  }
}

function looksLikeProject(dir) {
  if (!fs.existsSync(dir)) return false
  return (
    fs.existsSync(path.join(dir, 'package.json')) ||
    fs.existsSync(path.join(dir, 'jsconfig.json')) ||
    fs.existsSync(path.join(dir, 'vite.config.js')) ||
    fs.existsSync(path.join(dir, 'vue.config.js'))
  )
}

function stepAnalyze(fromRoot) {
  console.log('\n=== 1. Analyze source project ===')
  const written = writeAnalyze(fromRoot)
  console.log('Source analysis done →', written.graphPath)
  console.log('files=', written.graph.stats && written.graph.stats.fileCount)
  return written
}

function stepScaffold(toRoot, template, force) {
  console.log('\n=== 2. Copy migration base ===')
  if (looksLikeProject(toRoot) && !force) {
    console.log('Target already looks like a project; skip scaffold (use --force-scaffold to force)')
    return { skipped: true }
  }
  const from = path.resolve(template || path.join(REPO_ROOT, '1.pure-vue-app'))
  runNode('scaffold.js', ['--from', from, '--to', toRoot], 'scaffold')
  // Write migration metadata
  ensureProjectWorkDir(toRoot)
  return { skipped: false, template: from }
}

function copyTreeWithBackup(fromAbs, toAbs, baseRoot, dryRun, backup, batch) {
  const fg = require('fast-glob')
  const files = fg.sync(['**/*'], {
    cwd: fromAbs,
    absolute: true,
    onlyFiles: true,
    dot: false,
    ignore: sidecarCopyIgnoreGlobs(),
  })
  let backedUpCount = 0
  const copied = []
  files.forEach((abs) => {
    const rel = path.relative(fromAbs, abs)
    const dest = path.join(toAbs, rel)
    if (backup && !dryRun) {
      const b = backupIfExists(baseRoot, dest, batch.dir)
      if (b.backedUp) backedUpCount += 1
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(abs, dest)
    }
    copied.push({ from: abs, to: dest })
  })
  return { files: copied, backedUpCount }
}

function stepCopy(args) {
  console.log('\n=== 3. Copy source into target (backup if exists) ===')
  const fromDir = path.resolve(args.from, args.src)
  const toDir = path.resolve(args.to, args.destSrc)
  if (!fs.existsSync(fromDir)) {
    throw new Error('Source directory not found: ' + fromDir)
  }
  const result = ingestFiles({
    from: fromDir,
    to: toDir,
    sourceRoot: path.resolve(args.from),
    baseRoot: path.resolve(args.to),
    dryRun: args.dryRun,
    backup: args.backup,
  })
  console.log('Source:', fromDir)
  console.log('Target:', toDir)
  console.log('Files:', result.files.length)
  console.log('Backups:', result.backedUpCount, result.backupDir || '(none)')

  // Root-level sidecar dirs: script / test / style / mock … (whole-dir copy, any extension)
  const sidecars = listSidecarDirs(args.from)
  const sidecarResults = []
  if (sidecars.length) {
    const batch = args.backup && !args.dryRun ? ensureBackupBatch(args.to) : { dir: null }
    console.log('Sidecar dirs:', sidecars.join(', '))
    sidecars.forEach((name) => {
      if (isNeverCopyDir(name)) {
        console.log('  -', name, '→ skip (never-copy)')
        return
      }
      const fromSide = path.join(path.resolve(args.from), name)
      const toSide = path.join(path.resolve(args.to), name)
      const side = copyTreeWithBackup(
        fromSide,
        toSide,
        path.resolve(args.to),
        args.dryRun,
        args.backup,
        batch
      )
      console.log('  -', name, '→', side.files.length, 'files')
      sidecarResults.push({ name, files: side.files.length, backedUpCount: side.backedUpCount })
    })
  } else {
    console.log('Sidecar dirs: (none)')
  }

  ensureProjectWorkDir(args.to)
  fs.writeFileSync(
    path.join(projectWorkDir(args.to), 'migrate-copy.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        from: args.from,
        src: args.src,
        to: args.to,
        destSrc: args.destSrc,
        backedUpCount: result.backedUpCount,
        backupDir: result.backupDir,
        files: result.files.map((f) => ({
          from: f.from,
          to: f.to,
          backedUp: f.backedUp,
        })),
        sidecars: sidecarResults,
      },
      null,
      2
    ),
    'utf8'
  )
  return result
}

function stepPipeline(toRoot) {
  console.log('\n=== 4. Pipeline: auto-migrate + mark AI-TODO ===')
  runNode('run.js', [toRoot, '--keep', '--write'], 'pipeline')
}

function stepTodos(toRoot) {
  console.log('\n=== 5. Summarize AI-TODO (script pauses here) ===')
  runNode('todos.js', [toRoot], 'todos')
  const md = path.join(projectWorkDir(toRoot), 'ai-todos.md')
  const json = path.join(projectWorkDir(toRoot), 'ai-todos.json')
  console.log('\n======== AI handoff ========')
  console.log('Ask AI to open and process each item:')
  console.log('  ', fs.existsSync(md) ? md : json)
  console.log('Docs (English — AI should read these):')
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/en/workflow.md'))
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/en/html-format.md'))
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/en/cannot-fully-auto.md'))
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/en/ai-scaffold-notes.md'))
  const reportMd = path.join(projectWorkDir(toRoot), 'migration-report.md')
  if (fs.existsSync(reportMd)) {
    console.log('Ownership table (AI vs script vs compat):')
    console.log('  ', reportMd)
  }
  console.log('After AI finishes:')
  console.log('  node', path.join(BIN, 'migrate.js'), '--to', toRoot, '--step check')
  console.log('For another script migration round:')
  console.log('  node', path.join(BIN, 'migrate.js'), '--to', toRoot, '--step pipeline')
  console.log('========================\n')
}

function stepCheck(toRoot) {
  console.log('\n=== 6. Missing-refs check ===')
  runNode('check-refs.js', [toRoot, '--all'], 'check-refs')
  console.log('Check report:', path.join(projectWorkDir(toRoot), 'missing-refs-for-ai.md'))
  console.log('If missing: AI adds files / fixes imports, then re-run --step check')
  console.log('When green: --step pipeline for next round, or npm run build to verify')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const step = args.step
  const needFrom = ['analyze', 'copy', 'script', 'all'].includes(step)
  if (needFrom && !args.from) {
    printHelp()
    console.error('\nMissing --from')
    process.exit(1)
  }
  if (!args.to && step !== 'analyze') {
    printHelp()
    console.error('\nMissing --to')
    process.exit(1)
  }

  if (args.from) args.from = path.resolve(args.from)
  if (args.to) args.to = path.resolve(args.to)

  const state = {
    from: args.from,
    to: args.to,
    src: args.src,
    destSrc: args.destSrc,
    step,
    at: new Date().toISOString(),
  }

  try {
    if (step === 'analyze') {
      stepAnalyze(args.from)
    } else if (step === 'scaffold') {
      stepScaffold(args.to, args.template, true)
    } else if (step === 'copy') {
      stepCopy(args)
    } else if (step === 'pipeline') {
      stepPipeline(args.to)
    } else if (step === 'todos') {
      stepTodos(args.to)
    } else if (step === 'check') {
      stepCheck(args.to)
    } else if (step === 'script' || step === 'all') {
      stepAnalyze(args.from)
      // Only scaffold when explicitly requested; otherwise wait for AI Vue3 base
      const needScaffold = args.forceScaffold || args.scaffold
      if (needScaffold) {
        stepScaffold(args.to, args.template, args.forceScaffold)
      } else if (!looksLikeProject(args.to)) {
        console.log('\n=== 2. Base (waiting for AI) ===')
        console.log('Target has no project structure yet:', args.to)
        console.log('Ask AI to create a Vite+Vue3 base (incl. .env* / project config). Do not rely on --scaffold for real migrations.')
        console.log('After the base exists, re-run:')
        console.log(
          '  node',
          path.join(BIN, 'migrate.js'),
          '--from',
          args.from,
          '--src',
          args.src,
          '--to',
          args.to,
          '--step copy'
        )
        console.log('Then: --step pipeline && --step todos')
        ensureProjectWorkDir(args.to)
        fs.writeFileSync(
          path.join(projectWorkDir(args.to), 'migrate-state.json'),
          JSON.stringify(Object.assign({}, state, { handoff: 'ai-scaffold' }), null, 2),
          'utf8'
        )
        return
      } else {
        console.log('\n=== 2. Base ===')
        console.log('Using existing target project:', args.to)
      }
      stepCopy(args)
      stepPipeline(args.to)
      stepTodos(args.to)
      state.handoff = 'ai'
    } else {
      console.error('Unknown --step:', step)
      printHelp()
      process.exit(1)
    }

    if (args.to) {
      ensureProjectWorkDir(args.to)
      fs.writeFileSync(
        path.join(projectWorkDir(args.to), 'migrate-state.json'),
        JSON.stringify(state, null, 2),
        'utf8'
      )
    }
  } catch (e) {
    console.error('\nFailed:', e.message || e)
    process.exit(1)
  }
}

main()

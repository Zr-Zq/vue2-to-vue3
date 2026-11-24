#!/usr/bin/env node
/**
 * 迁移总入口（脚本侧）
 *
 * 约定用法：
 *   --from  被迁移的源项目根
 *   --src   源内要拷的目录（相对 from，默认 src）
 *   --to    迁移目标根目录（底座）
 *
 * 阶段：
 *   1 analyze   分析源项目 → <from>/.v23 与报告
 *   2 scaffold  （可选）拷纯 Vue 底座到 --to；正常由 AI 先建好底座
 *   3 copy      按相对路径 copy 到 --to，已存在则先备份再覆盖
 *   4 pipeline  脚本自动迁移 + 标记 AI-TODO
 *   5 todos     输出 AI 待改清单（到此脚本暂停，交给 AI）
 *   6 check     AI 改完后：缺引用检查
 *   7 pipeline  可再次 --step pipeline 跑下一轮
 *
 *   --step script  = analyze + copy + pipeline + todos（默认；不含 scaffold）
 *   --step all     = scaffold(若需要) + script（仍停在 AI 交接）
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
  console.log(`Usage: v23-migrate --from <源项目根> --to <目标根> [options]

工作流：
  分析源项目 →（AI 建底座）→ copy(备份后覆盖) → 流水线自动改+打 AI-TODO
  →【暂停】AI 改标记 → check-refs → 可再跑 pipeline

Required:
  --from <dir>          被迁移的 Vue2 项目根
  --to <dir>            迁移到的目标根（底座工程）

Options:
  --src <rel>           源内目录，相对 --from（默认 src）
  --dest-src <rel>      目标内目录，相对 --to（默认与 --src 相同）
  --step <name>         analyze|scaffold|copy|pipeline|todos|check|script|all
                        默认 script（analyze+copy+pipeline+todos）
  --scaffold            step=all/script 时若目标不像工程则自动拷底座
  --force-scaffold      强制用模板覆盖拷底座（慎用）
  --template <dir>      底座模板（默认仓库 1.pure-vue-app）
  --no-backup           copy 时不备份已存在文件
  --dry-run             copy 只演练
  -h, --help

Examples:
  v23-migrate --from D:/old-app --src src --to D:/new-app
  v23-migrate --from D:/old-app --to D:/new-app --step analyze
  v23-migrate --from D:/old-app --to D:/new-app --scaffold --step all
  # AI 改完 AI-TODO 后：
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
    throw new Error(label + ' 失败，exit=' + res.status)
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
  console.log('\n=== 1. 分析源项目 ===')
  const written = writeAnalyze(fromRoot)
  console.log('源分析完成 →', written.graphPath)
  console.log('files=', written.graph.stats && written.graph.stats.fileCount)
  return written
}

function stepScaffold(toRoot, template, force) {
  console.log('\n=== 2. 拷贝迁移底座 ===')
  if (looksLikeProject(toRoot) && !force) {
    console.log('目标已有工程结构，跳过 scaffold（需要强制请加 --force-scaffold）')
    return { skipped: true }
  }
  const from = path.resolve(template || path.join(REPO_ROOT, '1.pure-vue-app'))
  runNode('scaffold.js', ['--from', from, '--to', toRoot], 'scaffold')
  // 写一份迁移元数据
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
  console.log('\n=== 3. Copy 源码到目标（已存在则备份）===')
  const fromDir = path.resolve(args.from, args.src)
  const toDir = path.resolve(args.to, args.destSrc)
  if (!fs.existsSync(fromDir)) {
    throw new Error('源目录不存在: ' + fromDir)
  }
  const result = ingestFiles({
    from: fromDir,
    to: toDir,
    sourceRoot: path.resolve(args.from),
    baseRoot: path.resolve(args.to),
    dryRun: args.dryRun,
    backup: args.backup,
  })
  console.log('源:', fromDir)
  console.log('目标:', toDir)
  console.log('文件:', result.files.length)
  console.log('备份:', result.backedUpCount, result.backupDir || '(无)')

  // 根级旁路目录：script / test / style / mock …（整目录拷贝，不限扩展名）
  const sidecars = listSidecarDirs(args.from)
  const sidecarResults = []
  if (sidecars.length) {
    const batch = args.backup && !args.dryRun ? ensureBackupBatch(args.to) : { dir: null }
    console.log('旁路目录:', sidecars.join(', '))
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
    console.log('旁路目录: (无)')
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
  console.log('\n=== 4. 流水线：自动迁移 + 标记 AI-TODO ===')
  runNode('run.js', [toRoot, '--keep', '--write'], 'pipeline')
}

function stepTodos(toRoot) {
  console.log('\n=== 5. 汇总 AI-TODO（脚本到此暂停）===')
  runNode('todos.js', [toRoot], 'todos')
  const md = path.join(projectWorkDir(toRoot), 'ai-todos.md')
  const json = path.join(projectWorkDir(toRoot), 'ai-todos.json')
  console.log('\n======== AI 交接 ========')
  console.log('请 AI 打开并逐项处理:')
  console.log('  ', fs.existsSync(md) ? md : json)
  console.log('说明文档:')
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/workflow.md'))
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/html-format.md'))
  console.log('  ', path.join(REPO_ROOT, '2to3/docs/cannot-fully-auto.md'))
  console.log('AI 改完后执行:')
  console.log('  node', path.join(BIN, 'migrate.js'), '--to', toRoot, '--step check')
  console.log('若需再跑一轮脚本迁移:')
  console.log('  node', path.join(BIN, 'migrate.js'), '--to', toRoot, '--step pipeline')
  console.log('========================\n')
}

function stepCheck(toRoot) {
  console.log('\n=== 6. 缺引用检查 ===')
  runNode('check-refs.js', [toRoot, '--all'], 'check-refs')
  console.log('检查报告:', path.join(projectWorkDir(toRoot), 'missing-refs-for-ai.md'))
  console.log('若有缺失：AI 补文件/改 import 后复跑 --step check')
  console.log('通过后可 --step pipeline 进入下一轮，或 npm run build 验收')
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
    console.error('\n缺少 --from')
    process.exit(1)
  }
  if (!args.to && step !== 'analyze') {
    printHelp()
    console.error('\n缺少 --to')
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
      const needScaffold =
        args.forceScaffold ||
        args.scaffold ||
        (step === 'all' && !looksLikeProject(args.to))
      if (needScaffold) {
        stepScaffold(args.to, args.template, args.forceScaffold)
      } else if (!looksLikeProject(args.to)) {
        console.log('\n=== 2. 底座（等待 AI）===')
        console.log('目标尚无工程结构:', args.to)
        console.log('请 AI 先创建 Vue3 底座，或加 --scaffold 从模板拷贝后再继续。')
        console.log('建好后复跑:')
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
        console.log('然后: --step pipeline && --step todos')
        ensureProjectWorkDir(args.to)
        fs.writeFileSync(
          path.join(projectWorkDir(args.to), 'migrate-state.json'),
          JSON.stringify(Object.assign({}, state, { handoff: 'ai-scaffold' }), null, 2),
          'utf8'
        )
        return
      } else {
        console.log('\n=== 2. 底座 ===')
        console.log('使用已有目标工程:', args.to)
      }
      stepCopy(args)
      stepPipeline(args.to)
      stepTodos(args.to)
      state.handoff = 'ai'
    } else {
      console.error('未知 --step:', step)
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
    console.error('\n失败:', e.message || e)
    process.exit(1)
  }
}

main()

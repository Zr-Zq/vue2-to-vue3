const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { detectProjectRoot } = require('./detect-root')
const { loadProjectConfig } = require('./config')
const { rewriteFileContent } = require('./rewrite-imports')
const { toPosixRel } = require('./resolve')
const { ensureBackupBatch, backupIfExists } = require('./backup')

/**
 * 将源工程文件摄入到底座工程，并按底座路径配置重写 import
 *
 * @param {{
 *   from: string|string[],
 *   to: string,
 *   sourceRoot?: string,
 *   baseRoot?: string,
 *   dryRun?: boolean,
 *   backup?: boolean,
 *   backupStamp?: string,
 * }} options
 * - from: 源文件或目录
 * - to: 输出文件路径，或输出目录（from 为目录时）
 * - baseRoot: 底座根；默认从 to 向上自动检测
 * - sourceRoot: 源工程根；默认从 from 向上自动检测
 * - backup: 覆盖已存在目标前先备份（默认 true）
 */
function ingestFiles(options) {
  const opts = options || {}
  const fromInputs = [].concat(opts.from).map((p) => path.resolve(p))
  const toInput = path.resolve(opts.to)

  const sourceRoot =
    (opts.sourceRoot && path.resolve(opts.sourceRoot)) ||
    detectProjectRoot(fromInputs[0]) ||
    path.dirname(fromInputs[0])

  let baseRoot = opts.baseRoot && path.resolve(opts.baseRoot)
  if (!baseRoot) {
    baseRoot = detectProjectRoot(toInput)
  }
  if (!baseRoot) {
    // to 是新文件尚不存在时，从其父目录向上找
    baseRoot = detectProjectRoot(path.dirname(toInput))
  }
  if (!baseRoot) {
    throw new Error('无法检测底座项目根目录，请传 --base')
  }

  const sourceConfig = loadProjectConfig(sourceRoot)
  const baseConfig = loadProjectConfig(baseRoot)

  // 收集要复制的文件列表：{ fromAbs, toAbs }
  const pairs = []
  const fromIsDir = fromInputs.length === 1 && fs.existsSync(fromInputs[0]) && fs.statSync(fromInputs[0]).isDirectory()
  const toIsDirHint = opts.toDir || (fromIsDir && !/\.(vue|jsx?|tsx?|mjs|cjs)$/i.test(toInput))

  if (fromIsDir) {
    const files = fg.sync(['**/*.{vue,js,jsx,ts,tsx,mjs,cjs}'], {
      cwd: fromInputs[0],
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**'],
    })
    const outDir = toIsDirHint ? toInput : path.dirname(toInput)
    files.forEach((abs) => {
      const rel = path.relative(fromInputs[0], abs)
      pairs.push({ fromAbs: abs, toAbs: path.join(outDir, rel) })
    })
  } else {
    fromInputs.forEach((abs) => {
      if (!fs.existsSync(abs)) throw new Error('源文件不存在: ' + abs)
      let toAbs = toInput
      if (fromInputs.length > 1 || fs.existsSync(toInput) && fs.statSync(toInput).isDirectory()) {
        toAbs = path.join(toInput, path.basename(abs))
      }
      pairs.push({ fromAbs: abs, toAbs })
    })
  }

  // 路径映射表：源绝对路径 → 目标绝对路径
  const pathMap = new Map()
  pairs.forEach((p) => pathMap.set(path.normalize(p.fromAbs), path.normalize(p.toAbs)))

  const doBackup = opts.backup !== false
  let backupBatch = null
  if (!opts.dryRun && doBackup) {
    backupBatch = ensureBackupBatch(baseRoot, opts.backupStamp)
  }

  const results = []
  let backedUpCount = 0
  pairs.forEach((pair) => {
    const content = fs.readFileSync(pair.fromAbs, 'utf8')
    const ext = path.extname(pair.fromAbs).toLowerCase()
    const rewritten = rewriteFileContent(
      content,
      ext,
      pair.fromAbs,
      pair.toAbs,
      sourceConfig,
      baseConfig,
      pathMap
    )

    let backupInfo = { backedUp: false, backupPath: null }
    if (!opts.dryRun) {
      if (backupBatch) {
        backupInfo = backupIfExists(baseRoot, pair.toAbs, backupBatch.dir)
        if (backupInfo.backedUp) backedUpCount += 1
      }
      fs.mkdirSync(path.dirname(pair.toAbs), { recursive: true })
      fs.writeFileSync(pair.toAbs, rewritten.content, 'utf8')
    }

    results.push({
      from: toPosixRel(pair.fromAbs, sourceRoot) || pair.fromAbs,
      to: toPosixRel(pair.toAbs, baseRoot) || pair.toAbs,
      fromAbs: pair.fromAbs,
      toAbs: pair.toAbs,
      changes: rewritten.changes,
      error: rewritten.error || null,
      backedUp: backupInfo.backedUp,
      backupPath: backupInfo.backupPath,
    })
  })

  // 便于收尾 check-refs --files-from
  if (!opts.dryRun) {
    try {
      const work = path.join(baseRoot, '.v23')
      fs.mkdirSync(work, { recursive: true })
      const listPath = path.join(work, 'ingest-files.txt')
      fs.writeFileSync(
        listPath,
        results.map((r) => r.to).filter(Boolean).join('\n') + '\n',
        'utf8'
      )
    } catch (e) {
      /* ignore */
    }
  }

  return {
    sourceRoot,
    baseRoot,
    sourceAlias: sourceConfig.alias,
    baseAlias: baseConfig.alias,
    dryRun: !!opts.dryRun,
    backup: doBackup,
    backupDir: backupBatch ? backupBatch.dir : null,
    backupStamp: backupBatch ? backupBatch.stamp : null,
    backedUpCount,
    files: results,
  }
}

module.exports = {
  ingestFiles,
}

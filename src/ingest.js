const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { detectProjectRoot } = require('./detect-root')
const { loadProjectConfig } = require('./config')
const { rewriteFileContent } = require('./rewrite-imports')
const { toPosixRel } = require('./resolve')
const { ensureBackupBatch, backupIfExists } = require('./backup')

/** Code files whose imports are rewritten during ingest. */
const CODE_EXTS = new Set(['.vue', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'])

/** Binary / font / media — copy bytes, never utf8-rewrite. */
const BINARY_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.webm',
  '.wasm',
  '.pdf',
])

/**
 * Directory ingest globs: SFC/JS + styles + common static assets.
 * (Previously only *.{vue,js,...} — scss/css/images were dropped.)
 */
const INGEST_GLOBS = [
  '**/*.{vue,js,jsx,ts,tsx,mjs,cjs}',
  '**/*.{css,scss,sass,less,styl,stylus}',
  '**/*.{png,jpg,jpeg,gif,webp,ico,svg,bmp}',
  '**/*.{woff,woff2,ttf,eot,otf}',
  '**/*.{json,md,txt,html,htm}',
]

function isCodeExt(ext) {
  return CODE_EXTS.has(String(ext || '').toLowerCase())
}

function isBinaryExt(ext) {
  return BINARY_EXTS.has(String(ext || '').toLowerCase())
}

/**
 * Ingest source project files into the scaffold project and rewrite imports using scaffold path config
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
 * - from: source file(s) or directory
 * - to: output file path, or output directory (when from is a directory)
 * - baseRoot: scaffold root; default: walk up from to
 * - sourceRoot: source project root; default: walk up from from
 * - backup: back up before overwriting existing targets (default true)
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
    // When to is a new file that does not exist yet, walk up from its parent
    baseRoot = detectProjectRoot(path.dirname(toInput))
  }
  if (!baseRoot) {
    throw new Error('Cannot detect scaffold project root; pass --base')
  }

  const sourceConfig = loadProjectConfig(sourceRoot)
  const baseConfig = loadProjectConfig(baseRoot)

  // Collect file pairs to copy: { fromAbs, toAbs }
  const pairs = []
  const fromIsDir = fromInputs.length === 1 && fs.existsSync(fromInputs[0]) && fs.statSync(fromInputs[0]).isDirectory()
  const toIsDirHint = opts.toDir || (fromIsDir && !/\.(vue|jsx?|tsx?|mjs|cjs)$/i.test(toInput))

  if (fromIsDir) {
    const files = fg.sync(INGEST_GLOBS, {
      cwd: fromInputs[0],
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.v23/**'],
    })
    const outDir = toIsDirHint ? toInput : path.dirname(toInput)
    files.forEach((abs) => {
      const rel = path.relative(fromInputs[0], abs)
      pairs.push({ fromAbs: abs, toAbs: path.join(outDir, rel) })
    })
  } else {
    fromInputs.forEach((abs) => {
      if (!fs.existsSync(abs)) throw new Error('Source file not found: ' + abs)
      let toAbs = toInput
      if (fromInputs.length > 1 || fs.existsSync(toInput) && fs.statSync(toInput).isDirectory()) {
        toAbs = path.join(toInput, path.basename(abs))
      }
      pairs.push({ fromAbs: abs, toAbs })
    })
  }

  // Path map: source absolute path → destination absolute path
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
    const ext = path.extname(pair.fromAbs).toLowerCase()
    let rewritten = { content: null, changes: [], error: null }
    let binary = false

    if (isBinaryExt(ext)) {
      binary = true
    } else if (isCodeExt(ext)) {
      const content = fs.readFileSync(pair.fromAbs, 'utf8')
      rewritten = rewriteFileContent(
        content,
        ext,
        pair.fromAbs,
        pair.toAbs,
        sourceConfig,
        baseConfig,
        pathMap
      )
    } else {
      // Styles / svg / markdown / etc. — copy text as-is (no import rewrite)
      rewritten = { content: fs.readFileSync(pair.fromAbs, 'utf8'), changes: [], error: null }
    }

    let backupInfo = { backedUp: false, backupPath: null }
    if (!opts.dryRun) {
      if (backupBatch) {
        backupInfo = backupIfExists(baseRoot, pair.toAbs, backupBatch.dir)
        if (backupInfo.backedUp) backedUpCount += 1
      }
      fs.mkdirSync(path.dirname(pair.toAbs), { recursive: true })
      if (binary) {
        fs.copyFileSync(pair.fromAbs, pair.toAbs)
      } else {
        fs.writeFileSync(pair.toAbs, rewritten.content, 'utf8')
      }
    }

    results.push({
      from: toPosixRel(pair.fromAbs, sourceRoot) || pair.fromAbs,
      to: toPosixRel(pair.toAbs, baseRoot) || pair.toAbs,
      fromAbs: pair.fromAbs,
      toAbs: pair.toAbs,
      changes: rewritten.changes,
      error: rewritten.error || null,
      binary,
      backedUp: backupInfo.backedUp,
      backupPath: backupInfo.backupPath,
    })
  })

  // For follow-up check-refs --files-from
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
  INGEST_GLOBS,
  isCodeExt,
  isBinaryExt,
}

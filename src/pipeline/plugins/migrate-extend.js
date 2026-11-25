const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { createPlugin } = require('../create-plugin')
const {
  migrateExtend,
  applyExtendNew,
  analyzeExtendModule,
  ensureCompatImport,
} = require('../../transform/js-extend')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const { decomposeVue } = require('../../sfc-parts')
const { loadProjectConfig } = require('../../config')
const { ensureProjectWorkDir, projectWorkDir } = require('../../paths')

const EXTEND_REL = 'src/compat/v23-extend.js'
const TEMPLATE_EXTEND = path.join(__dirname, '../../../templates/v23-extend.js')
const CODE_RE = /\.(vue|js|jsx|mjs|cjs|ts|tsx)$/i

function ensureLedger(project) {
  if (!project.shared.migrationLedger) project.shared.migrationLedger = []
  return project.shared.migrationLedger
}

function ensureExtendFile(project) {
  if (!project || !project.root) return
  const dest = path.join(project.root, EXTEND_REL)
  const template = fs.readFileSync(TEMPLATE_EXTEND, 'utf8')
  const ledger = ensureLedger(project)
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, template, 'utf8')
    ledger.push({
      who: 'script',
      kind: 'compat-add',
      file: EXTEND_REL,
      detail: 'Added constructable Vue.extend shim (v23-extend) so new Ctor() still works',
    })
    return
  }
  const cur = fs.readFileSync(dest, 'utf8')
  if (cur.includes('function __v23New')) return
  if (!cur.includes('__v23Extend')) return
  fs.writeFileSync(dest, template, 'utf8')
  ledger.push({
    who: 'script',
    kind: 'compat-update',
    file: EXTEND_REL,
    detail: 'Updated v23-extend with __v23New for extend call sites',
  })
}

function norm(p) {
  return path.resolve(p)
}

function findFile(base) {
  const clean = String(base).split('?')[0].split('#')[0]
  if (fs.existsSync(clean) && fs.statSync(clean).isFile()) return norm(clean)
  const exts = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue']
  for (let i = 0; i < exts.length; i += 1) {
    const hit = clean + exts[i]
    if (fs.existsSync(hit) && fs.statSync(hit).isFile()) return norm(hit)
  }
  for (let i = 0; i < exts.length; i += 1) {
    const hit = path.join(clean, 'index' + exts[i])
    if (fs.existsSync(hit) && fs.statSync(hit).isFile()) return norm(hit)
  }
  return null
}

function resolveSpecifier(fromAbs, spec, alias) {
  if (!spec || typeof spec !== 'string') return null
  const raw = spec.split('?')[0].split('#')[0]
  if (!raw || raw.charAt(0) === '\0') return null
  let base = null
  if (raw.startsWith('.')) {
    base = path.resolve(path.dirname(fromAbs), raw)
  } else if (alias) {
    const keys = Object.keys(alias).sort((a, b) => b.length - a.length)
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      if (raw === key) {
        base = alias[key]
        break
      }
      if (raw.startsWith(key + '/')) {
        base = path.join(alias[key], raw.slice(key.length + 1))
        break
      }
    }
  }
  if (!base) return null
  return findFile(base)
}

function listCodeFiles(root) {
  const cfg = loadProjectConfig(root)
  const files = fg.sync(cfg.include, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: cfg.exclude,
  })
  return { cfg, files: files.filter((f) => CODE_RE.test(f)) }
}

function readJsPieces(abs, content) {
  if (abs.endsWith('.vue')) {
    const parts = decomposeVue(content, abs)
    return (parts.jsParts || []).map((p) => p.code)
  }
  return [content]
}

function mergeAnalysis(pieces) {
  const named = new Set()
  let hasDefault = false
  const reexports = []
  pieces.forEach((code) => {
    const one = analyzeExtendModule(code)
    one.named.forEach((n) => named.add(n))
    if (one.hasDefault) hasDefault = true
    one.reexports.forEach((r) => reexports.push(r))
  })
  return { named, hasDefault, reexports }
}

function buildExportIndex(files, alias) {
  const index = new Map()
  files.forEach((abs) => {
    let content = ''
    try {
      content = fs.readFileSync(abs, 'utf8')
    } catch (e) {
      return
    }
    index.set(norm(abs), mergeAnalysis(readJsPieces(abs, content)))
  })
  let guard = 0
  let changed = true
  while (changed && guard < 20) {
    guard += 1
    changed = false
    index.forEach((info, abs) => {
      info.reexports.forEach((re) => {
        const target = resolveSpecifier(abs, re.source, alias)
        if (!target) return
        const src = index.get(norm(target))
        if (!src) return
        const ok = re.imported === 'default' ? src.hasDefault : src.named.has(re.imported)
        if (!ok) return
        if (re.exported === 'default') {
          if (!info.hasDefault) {
            info.hasDefault = true
            changed = true
          }
        } else if (re.exported && !info.named.has(re.exported)) {
          info.named.add(re.exported)
          changed = true
        }
      })
    })
  }
  return index
}

function importedLocalsInJs(code, fromAbs, index, alias) {
  const names = []
  let ast
  try {
    const { parseModule } = require('../../transform/js-extend')
    ast = parseModule(code)
  } catch (e) {
    return names
  }
  const traverse = require('@babel/traverse').default
  const t = require('@babel/types')
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.importKind === 'type') return
      const resolved = resolveSpecifier(fromAbs, p.node.source.value, alias)
      if (!resolved) return
      const info = index.get(norm(resolved))
      if (!info) return
      p.node.specifiers.forEach((spec) => {
        if (spec.importKind === 'type') return
        if (t.isImportSpecifier(spec)) {
          const imported = spec.imported.name || spec.imported.value
          const hit = imported === 'default' ? info.hasDefault : info.named.has(imported)
          if (hit) names.push(spec.local.name)
        } else if (t.isImportDefaultSpecifier(spec) && info.hasDefault) {
          names.push(spec.local.name)
        }
      })
    },
  })
  return names
}

function rewriteOne(content, abs, index, alias) {
  const run = (js) => {
    const names = importedLocalsInJs(js, abs, index, alias)
    const neu = applyExtendNew(js, names)
    if (!neu.changes.length) return { code: js, changes: [] }
    const imp = ensureCompatImport(neu.code, { dropVue: false })
    const changes = neu.changes.slice()
    if (imp.added) changes.push({ kind: 'import-v23-extend' })
    return { code: imp.code, changes }
  }
  if (/\.vue$/i.test(abs)) {
    const applied = applySfcTransforms(content, abs, null, (js) => run(js))
    return { code: applied.content, changes: applied.changes }
  }
  return run(content)
}

/**
 * After factories exist, rewrite `new` call sites that import those factories.
 * Safe to run on a project that already went through migrateExtend.
 */
function rewriteExtendCallsInProject(root) {
  const project = { root: path.resolve(root), dryRun: false, shared: Object.create(null) }
  return applyExtendCallRewrite(project)
}

function applyExtendCallRewrite(project) {
  if (!project || !project.root || project.dryRun) return { files: 0, changes: 0 }
  const { cfg, files } = listCodeFiles(project.root)
  const index = buildExportIndex(files, cfg.alias)
  let fileCount = 0
  let changeCount = 0
  const ledger = ensureLedger(project)
  files.forEach((abs) => {
    const rel = path.relative(project.root, abs).split(path.sep).join('/')
    if (rel === EXTEND_REL) return
    let content
    try {
      content = fs.readFileSync(abs, 'utf8')
    } catch (e) {
      return
    }
    const result = rewriteOne(content, abs, index, cfg.alias)
    if (!result.changes.length || result.code === content) return
    fs.writeFileSync(abs, result.code, 'utf8')
    fileCount += 1
    changeCount += result.changes.length
    ledger.push({
      who: 'script',
      kind: 'rewrite',
      file: rel,
      detail: 'Rewrote new ExtendCtor() to __v23New ×' + result.changes.length,
    })
  })
  if (fileCount) ensureExtendFile(project)
  if (ledger.length) {
    const work = ensureProjectWorkDir(project.root)
    fs.writeFileSync(
      path.join(work, 'migration-ledger.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), items: ledger }, null, 2),
      'utf8'
    )
  }
  return { files: fileCount, changes: changeCount }
}

module.exports = createPlugin({
  name: 'migrate-extend',
  description: 'Vue.extend / Sub.extend to __v23Extend; new Ctor() to __v23New',
  version: '0.3.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /\.extend\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js) =>
        migrateExtend(js)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ensureExtendFile(api.project)
        ctx.setContent(result.content, 'migrate-extend')
        ctx.report({
          level: 'info',
          plugin: 'migrate-extend',
          message: 'extend rewrites ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateExtend(ctx.file.content)
    if (result.changes.length && result.code !== ctx.file.content) {
      ensureExtendFile(api.project)
      ctx.setContent(result.code, 'migrate-extend')
      ctx.report({
        level: 'info',
        plugin: 'migrate-extend',
        message: 'extend rewrites ×' + result.changes.length,
      })
    }
  },
  async teardown(project, api) {
    if (api && api.options && api.options.enabled === false) return
    const result = applyExtendCallRewrite(project)
    if (result.files) {
      api.log('extend call sites rewritten in ' + result.files + ' file(s)')
    }
  },
})

module.exports.rewriteExtendCallsInProject = rewriteExtendCallsInProject
module.exports.ensureExtendFile = ensureExtendFile

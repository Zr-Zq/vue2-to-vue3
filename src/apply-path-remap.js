/**
 * Apply AI-authored path remaps to import/require/dynamic-import strings.
 *
 * Scope is intentionally limited to files listed in `.v23/ingest-files.txt`
 * (this ingest/migrate batch) so AI-built base files are not rewritten.
 *
 * Mapping file: `<to>/.v23/path-remap.json` (see docs/en/path-remap.md).
 */
const fs = require('fs')
const path = require('path')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { parseJs } = require('./parse-file')
const { decomposeVue, isRealJsScript } = require('./sfc-parts')
const { projectWorkDir, ensureProjectWorkDir } = require('./paths')

const REMAP_JSON = 'path-remap.json'
const REMAP_MD = 'path-remap.md'
const INGEST_LIST = 'ingest-files.txt'

function loadRemap(baseRoot) {
  const p = path.join(projectWorkDir(baseRoot), REMAP_JSON)
  if (!fs.existsSync(p)) return { path: p, exists: false, mappings: [], raw: null }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  const mappings = normalizeMappings(raw && raw.mappings)
  return { path: p, exists: true, mappings, raw, notes: (raw && raw.notes) || '' }
}

function normalizeMappings(list) {
  if (!Array.isArray(list)) return []
  const out = []
  list.forEach((m) => {
    if (!m || typeof m !== 'object') return
    const from = String(m.from || '').trim()
    const to = String(m.to || '').trim()
    if (!from || to === '' || from === to) return
    out.push({ from, to, kind: m.kind === 'exact' ? 'exact' : 'prefix' })
  })
  // Longest from first so @/util/foo wins over @/util
  out.sort((a, b) => b.from.length - a.from.length)
  return out
}

function applyMapping(specifier, mappings) {
  if (!specifier || typeof specifier !== 'string') return null
  for (let i = 0; i < mappings.length; i += 1) {
    const { from, to, kind } = mappings[i]
    if (kind === 'exact') {
      if (specifier === from) return to
      continue
    }
    // prefix: exact match OR from is a path prefix (ends with / or followed by /)
    if (specifier === from) return to
    if (from.endsWith('/')) {
      if (specifier.startsWith(from)) return to + specifier.slice(from.length)
    } else if (specifier.startsWith(from + '/')) {
      return to + specifier.slice(from.length)
    }
  }
  return null
}

function rewriteJsSpecifiers(code, filePath, mappings) {
  let ast
  try {
    ast = parseJs(code, filePath)
  } catch (e) {
    return { code, changes: [], error: e.message }
  }
  const changes = []
  const edits = []

  function consider(node) {
    if (!node || !t.isStringLiteral(node)) return
    const next = applyMapping(node.value, mappings)
    if (!next || next === node.value) return
    changes.push({ from: node.value, to: next, loc: node.loc && node.loc.start })
    const quote = code[node.start] === "'" ? "'" : '"'
    edits.push({
      start: node.start,
      end: node.end,
      text: quote + next.replace(/\\/g, '/') + quote,
    })
  }

  traverse(ast, {
    ImportDeclaration(p) {
      consider(p.node.source)
    },
    ExportNamedDeclaration(p) {
      if (p.node.source) consider(p.node.source)
    },
    ExportAllDeclaration(p) {
      if (p.node.source) consider(p.node.source)
    },
    CallExpression(p) {
      const callee = p.node.callee
      if (t.isIdentifier(callee, { name: 'require' }) && p.node.arguments[0]) {
        consider(p.node.arguments[0])
      }
      if (callee.type === 'Import' && p.node.arguments[0]) {
        consider(p.node.arguments[0])
      }
    },
  })

  edits.sort((a, b) => b.start - a.start)
  let out = code
  edits.forEach((e) => {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  })
  return { code: out, changes, error: null }
}

function rewriteFileContent(content, ext, absPath, mappings) {
  if (ext === '.vue') {
    const parts = decomposeVue(content, absPath)
    let out = content
    const allChanges = []
    ;(parts.scripts || []).forEach((entry) => {
      if (!entry.isRealCode) return
      const check = isRealJsScript(
        entry.rawBlock || { content: entry.code, lang: entry.lang, attrs: entry.attrs, src: entry.src }
      )
      if (!check.ok) return
      const rewritten = rewriteJsSpecifiers(entry.code, absPath + '#' + entry.id, mappings)
      allChanges.push(...rewritten.changes.map((c) => Object.assign({ scriptId: entry.id }, c)))
      if (rewritten.code !== entry.code) {
        const idx = out.indexOf(entry.code)
        if (idx !== -1) {
          out = out.slice(0, idx) + rewritten.code + out.slice(idx + entry.code.length)
        }
      }
    })
    return { content: out, changes: allChanges }
  }
  if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(ext)) {
    const rewritten = rewriteJsSpecifiers(content, absPath, mappings)
    return { content: rewritten.code, changes: rewritten.changes, error: rewritten.error }
  }
  return { content, changes: [] }
}

function readScopeList(baseRoot, filesFrom) {
  const listPath = filesFrom
    ? path.resolve(filesFrom)
    : path.join(projectWorkDir(baseRoot), INGEST_LIST)
  if (!fs.existsSync(listPath)) {
    return { listPath, files: [], missing: true }
  }
  const files = fs
    .readFileSync(listPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  return { listPath, files, missing: false }
}

/**
 * @param {{
 *   baseRoot: string,
 *   filesFrom?: string|null,
 *   remapPath?: string|null,
 *   dryRun?: boolean,
 * }} opts
 */
function applyPathRemap(opts) {
  const baseRoot = path.resolve(opts.baseRoot)
  ensureProjectWorkDir(baseRoot)

  let remap
  if (opts.remapPath) {
    const p = path.resolve(opts.remapPath)
    if (!fs.existsSync(p)) {
      return { ok: false, error: 'remap file missing: ' + p, files: [] }
    }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    remap = {
      path: p,
      exists: true,
      mappings: normalizeMappings(raw && raw.mappings),
      raw,
      notes: (raw && raw.notes) || '',
    }
  } else {
    remap = loadRemap(baseRoot)
  }

  if (!remap.exists) {
    return {
      ok: false,
      error: 'no ' + REMAP_JSON + ' — AI should write .v23/' + REMAP_JSON + ' (+ ' + REMAP_MD + ')',
      remapPath: remap.path,
      files: [],
    }
  }
  if (!remap.mappings.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'empty mappings',
      remapPath: remap.path,
      files: [],
    }
  }

  const scope = readScopeList(baseRoot, opts.filesFrom || null)
  if (scope.missing || !scope.files.length) {
    return {
      ok: false,
      error:
        'no ingest file list — expected .v23/' +
        INGEST_LIST +
        ' (or pass --files-from). Remap refuses to touch the whole tree.',
      listPath: scope.listPath,
      remapPath: remap.path,
      files: [],
    }
  }

  const results = []
  let changedCount = 0
  scope.files.forEach((rel) => {
    const abs = path.isAbsolute(rel) ? rel : path.join(baseRoot, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      results.push({ file: rel, skipped: true, reason: 'missing' })
      return
    }
    const ext = path.extname(abs).toLowerCase()
    if (!/\.(vue|jsx?|tsx?|mjs|cjs)$/i.test(ext)) {
      results.push({ file: rel, skipped: true, reason: 'not-js' })
      return
    }
    const before = fs.readFileSync(abs, 'utf8')
    const rewritten = rewriteFileContent(before, ext, abs, remap.mappings)
    const hit = rewritten.changes.filter((c) => c.to)
    if (!hit.length) {
      results.push({ file: rel, changes: [], written: false })
      return
    }
    if (!opts.dryRun && rewritten.content !== before) {
      fs.writeFileSync(abs, rewritten.content, 'utf8')
      changedCount += 1
    }
    results.push({
      file: rel,
      changes: hit,
      written: !opts.dryRun && rewritten.content !== before,
      dryRun: !!opts.dryRun,
    })
  })

  const report = {
    ok: true,
    dryRun: !!opts.dryRun,
    baseRoot,
    remapPath: remap.path,
    notes: remap.notes,
    mappingCount: remap.mappings.length,
    scopeList: scope.listPath,
    scopedFileCount: scope.files.length,
    changedCount,
    files: results,
  }

  try {
    const outPath = path.join(projectWorkDir(baseRoot), 'path-remap-report.json')
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')
    report.reportPath = outPath
  } catch (_) {
    /* ignore */
  }

  return report
}

/** Markdown stub AI can fill; does not overwrite if already present. */
function ensureRemapStub(baseRoot) {
  ensureProjectWorkDir(baseRoot)
  const work = projectWorkDir(baseRoot)
  const jsonPath = path.join(work, REMAP_JSON)
  const mdPath = path.join(work, REMAP_MD)
  const created = []
  if (!fs.existsSync(jsonPath)) {
    const stub = {
      version: 1,
      generatedBy: 'ai',
      notes: 'Fill mappings after comparing source layout vs Vue3 base. Empty mappings = no-op.',
      mappings: [
        // { "from": "@/util/", "to": "@/utils/" },
        // { "from": "@/util", "to": "@/utils" },
        // { "from": "@/axios", "to": "@/api/axios", "kind": "exact" }
      ],
    }
    fs.writeFileSync(jsonPath, JSON.stringify(stub, null, 2) + '\n', 'utf8')
    created.push(jsonPath)
  }
  if (!fs.existsSync(mdPath)) {
    const md =
      '# Path remap (temporary)\n\n' +
      'AI: compare **source** layout vs **Vue3 base** after scaffold/copy. ' +
      'Record directory/file renames that break imports in ingested files only.\n\n' +
      '| Source path / specifier prefix | Base path / specifier | Why |\n' +
      '|--------------------------------|-----------------------|-----|\n' +
      '| `@/util/` | `@/utils/` | scaffold renamed util→utils |\n' +
      '| `@/axios` | `@/api/axios` | axios moved under api |\n\n' +
      'Machine file: `path-remap.json` (same mappings). ' +
      'Apply: `v23-apply-path-remap <to>` (scoped to `ingest-files.txt`).\n'
    fs.writeFileSync(mdPath, md, 'utf8')
    created.push(mdPath)
  }
  return { jsonPath, mdPath, created }
}

module.exports = {
  REMAP_JSON,
  REMAP_MD,
  INGEST_LIST,
  loadRemap,
  normalizeMappings,
  applyMapping,
  applyPathRemap,
  ensureRemapStub,
  rewriteJsSpecifiers,
  rewriteFileContent,
}

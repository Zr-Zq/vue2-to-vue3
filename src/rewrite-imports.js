const path = require('path')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { parseJs } = require('./parse-file')
const { decomposeVue, isRealJsScript } = require('./sfc-parts')
const { resolveImport, toPosixRel } = require('./resolve')

/**
 * Prefer writing an absolute path as a scaffold-project alias or relative path
 */
function formatImportForBase(absTarget, fromAbsFile, baseConfig) {
  const root = baseConfig.root
  const relFromRoot = toPosixRel(absTarget, root)

  // Prefer alias (longest prefix)
  const aliasKeys = Object.keys(baseConfig.alias || {}).sort((a, b) => b.length - a.length)
  for (let i = 0; i < aliasKeys.length; i += 1) {
    const key = aliasKeys[i]
    const aliasRoot = baseConfig.alias[key]
    const inside = toPosixRel(absTarget, aliasRoot)
    if (inside && !inside.startsWith('..')) {
      // Drop extension (matches common project import style)
      const noExt = stripExt(inside)
      return key + (noExt ? '/' + noExt : '')
    }
  }

  // Relative path
  let rel = path.relative(path.dirname(fromAbsFile), absTarget).split(path.sep).join('/')
  rel = stripExt(rel)
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

function stripExt(p) {
  return p.replace(/\.(vue|jsx?|tsx?|mjs|cjs|json)$/i, '')
}

/**
 * Map a specifier in the source file to a new specifier
 * @returns {{ next: string|null, reason: string, resolved: string|null }}
 */
function rewriteSpecifier(specifier, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap) {
  if (!specifier || /^(https?:)?\/\//.test(specifier) || specifier.startsWith('data:')) {
    return { next: null, reason: 'url', resolved: null }
  }

  // Already in explicit map (batch ingest: old abs → new abs)
  const hit = resolveImport(specifier, fromAbsSource, sourceConfig)
  if (hit.external || !hit.resolved) {
    // Source resolve failed: if @/ and scaffold has same alias, switch to scaffold meaning (keep path segments)
    if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
      return { next: specifier, reason: 'alias-passthrough', resolved: null }
    }
    return { next: null, reason: hit.kind || 'external', resolved: null }
  }

  const srcAbs = hit.resolved
  if (pathMap && pathMap.has(srcAbs)) {
    const destAbs = pathMap.get(srcAbs)
    return {
      next: formatImportForBase(destAbs, toAbsDest, baseConfig),
      reason: 'mapped',
      resolved: srcAbs,
    }
  }

  // Single file: dep still inside source project → map via mirrored path relative to source root
  const relInSource = toPosixRel(srcAbs, sourceConfig.root)
  if (relInSource && !relInSource.startsWith('..')) {
    const mirrored = path.join(baseConfig.root, relInSource)
    return {
      next: formatImportForBase(mirrored, toAbsDest, baseConfig),
      reason: 'mirror',
      resolved: srcAbs,
      mirrored,
    }
  }

  return { next: null, reason: 'outside-source', resolved: srcAbs }
}

function replaceQuoteLiteral(code, start, end, newValue) {
  // start/end are char offsets (babel node.start/end)
  return code.slice(0, start) + JSON.stringify(newValue).replace(/^"|"$/g, (m) => {
    // Prefer keeping original quotes
    return m
  })
}

/**
 * Rewrite import/require string literals in a JS snippet
 */
function rewriteJsCode(code, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap) {
  let ast
  try {
    ast = parseJs(code, fromAbsSource)
  } catch (e) {
    return { code, changes: [], error: e.message }
  }

  const changes = []
  const edits = []

  function consider(node, raw) {
    if (!node || !t.isStringLiteral(node)) return
    const result = rewriteSpecifier(node.value, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap)
    if (!result.next || result.next === node.value) {
      if (result.reason && result.reason !== 'alias-passthrough') {
        changes.push({
          from: node.value,
          to: null,
          reason: result.reason,
          loc: node.loc && node.loc.start,
        })
      }
      return
    }
    changes.push({
      from: node.value,
      to: result.next,
      reason: result.reason,
      loc: node.loc && node.loc.start,
    })
    const quote = code[node.start] === "'" ? "'" : '"'
    const replacement = quote + result.next.replace(/\\/g, '/') + quote
    edits.push({ start: node.start, end: node.end, text: replacement })
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

  // Apply from back to front to avoid offset drift
  edits.sort((a, b) => b.start - a.start)
  let out = code
  edits.forEach((e) => {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  })

  return { code: out, changes, error: null }
}

/**
 * Rewrite whole file content:
 * - .vue: JS rewrite only for real script code; template(html) imports untouched
 * - .js/.ts: whole file through JS
 */
function rewriteFileContent(content, ext, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap) {
  const allChanges = []
  if (ext === '.vue') {
    const parts = decomposeVue(content, fromAbsSource)
    let out = content

    ;(parts.scripts || []).forEach((entry) => {
      if (!entry.isRealCode) {
        allChanges.push({
          from: null,
          to: null,
          reason: 'skip-script:' + (entry.skipReason || 'not-code'),
          scriptId: entry.id,
        })
        return
      }
      const check = isRealJsScript(entry.rawBlock || { content: entry.code, lang: entry.lang, attrs: entry.attrs, src: entry.src })
      if (!check.ok) return

      const rewritten = rewriteJsCode(
        entry.code,
        fromAbsSource,
        toAbsDest,
        sourceConfig,
        baseConfig,
        pathMap
      )
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

  const rewritten = rewriteJsCode(content, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap)
  return { content: rewritten.code, changes: rewritten.changes, error: rewritten.error }
}

module.exports = {
  formatImportForBase,
  rewriteSpecifier,
  rewriteJsCode,
  rewriteFileContent,
  stripExt,
}

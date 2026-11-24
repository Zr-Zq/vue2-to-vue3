const path = require('path')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { parseJs } = require('./parse-file')
const { decomposeVue, isRealJsScript } = require('./sfc-parts')
const { resolveImport, toPosixRel } = require('./resolve')

/**
 * 把绝对路径尽量写成底座项目的 alias 或相对路径
 */
function formatImportForBase(absTarget, fromAbsFile, baseConfig) {
  const root = baseConfig.root
  const relFromRoot = toPosixRel(absTarget, root)

  // 优先 alias（最长前缀）
  const aliasKeys = Object.keys(baseConfig.alias || {}).sort((a, b) => b.length - a.length)
  for (let i = 0; i < aliasKeys.length; i += 1) {
    const key = aliasKeys[i]
    const aliasRoot = baseConfig.alias[key]
    const inside = toPosixRel(absTarget, aliasRoot)
    if (inside && !inside.startsWith('..')) {
      // 去掉扩展名（跟常见工程 import 习惯一致）
      const noExt = stripExt(inside)
      return key + (noExt ? '/' + noExt : '')
    }
  }

  // 相对路径
  let rel = path.relative(path.dirname(fromAbsFile), absTarget).split(path.sep).join('/')
  rel = stripExt(rel)
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

function stripExt(p) {
  return p.replace(/\.(vue|jsx?|tsx?|mjs|cjs|json)$/i, '')
}

/**
 * 源文件中的 specifier → 新 specifier
 * @returns {{ next: string|null, reason: string, resolved: string|null }}
 */
function rewriteSpecifier(specifier, fromAbsSource, toAbsDest, sourceConfig, baseConfig, pathMap) {
  if (!specifier || /^(https?:)?\/\//.test(specifier) || specifier.startsWith('data:')) {
    return { next: null, reason: 'url', resolved: null }
  }

  // 已在显式映射表（批量 ingest 时：旧绝对路径 → 新绝对路径）
  const hit = resolveImport(specifier, fromAbsSource, sourceConfig)
  if (hit.external || !hit.resolved) {
    // 源侧解析失败：若是 @/ 且底座也有同名 alias，直接换成底座语义（路径段保留）
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

  // 单文件：依赖仍在源工程内 → 尽量按「相对源根的镜像路径」映射到底座
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
  // start/end 是字符索引（babel 的 node.start/end）
  return code.slice(0, start) + JSON.stringify(newValue).replace(/^"|"$/g, (m) => {
    // 尽量保留原引号
    return m
  })
}

/**
 * 对一段 JS 代码重写 import/require 字符串
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

  // 从后往前应用，避免偏移
  edits.sort((a, b) => b.start - a.start)
  let out = code
  edits.forEach((e) => {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  })

  return { code: out, changes, error: null }
}

/**
 * 重写整个文件内容：
 * - .vue：只对「真代码」script 走 JS 重写；template(html) 不改 import
 * - .js/.ts：整文件走 JS
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

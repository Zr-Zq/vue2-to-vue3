/**
 * webpack-style dynamic imports with runtime segments to Vite import.meta.glob lookup.
 *
 *   import('@/views/' + name + '.vue')        (webpack builds a context module)
 *   import(`./pages/${name}.vue`)
 * to
 *   const __v23Glob0 = import.meta.glob('../views/**' + '/*.vue')   // relative to the importer
 *   __v23LoadGlob(__v23Glob0, '../views/' + name + '.vue')
 *
 * Vite cannot analyze concatenation with the `@` alias, so the browser receives a bare
 * '@/…' specifier and fails. Scope: static prefix starting with '@/', './' or '../' and a
 * static suffix ending in a file extension. Anything else is left untouched (AI).
 * `@` is assumed to map to <projectRoot>/src (the Vite base contract).
 */
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')

const BABEL_PLUGINS = [
  'jsx',
  'typescript',
  'classProperties',
  'decorators-legacy',
  'objectRestSpread',
  'dynamicImport',
  'optionalChaining',
  'nullishCoalescingOperator',
]

const LOADER_ID = '__v23LoadGlob'

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/** Flatten a left-associative `a + b + c` string concatenation. */
function flattenConcat(node) {
  if (t.isBinaryExpression(node, { operator: '+' })) {
    return flattenConcat(node.left).concat(flattenConcat(node.right))
  }
  return [node]
}

/**
 * @returns {{ prefix: string, suffix: string, rebuild: (newPrefix: string) => object } | null}
 */
function splitSpecifier(arg) {
  if (t.isTemplateLiteral(arg)) {
    if (!arg.expressions.length) return null
    const first = arg.quasis[0].value.cooked
    const last = arg.quasis[arg.quasis.length - 1].value.cooked
    return {
      prefix: first,
      suffix: last,
      rebuild(newPrefix) {
        const quasis = arg.quasis.map((q, i) =>
          i === 0
            ? t.templateElement({ raw: newPrefix.replace(/[`\\$]/g, '\\$&'), cooked: newPrefix }, q.tail)
            : t.cloneNode(q, true)
        )
        return t.templateLiteral(quasis, arg.expressions.map((e) => t.cloneNode(e, true)))
      },
    }
  }
  if (t.isBinaryExpression(arg, { operator: '+' })) {
    const parts = flattenConcat(arg)
    if (parts.length < 2) return null
    const head = parts[0]
    const tail = parts[parts.length - 1]
    if (!t.isStringLiteral(head) || !t.isStringLiteral(tail)) return null
    if (parts.slice(1, -1).every((p) => t.isStringLiteral(p))) return null
    return {
      prefix: head.value,
      suffix: tail.value,
      rebuild(newPrefix) {
        const nodes = parts.map((p, i) => (i === 0 ? t.stringLiteral(newPrefix) : t.cloneNode(p, true)))
        return nodes.slice(1).reduce((acc, n) => t.binaryExpression('+', acc, n), nodes[0])
      },
    }
  }
  return null
}

/** '@/x/y/' to path relative to the importer dir, always starting with './' or '../' */
function relativePrefix(prefix, importerAbs, projectRoot) {
  let targetAbs
  if (prefix.startsWith('@/')) {
    if (!projectRoot) return null
    targetAbs = path.join(projectRoot, 'src', prefix.slice(2))
  } else if (prefix.startsWith('./') || prefix.startsWith('../')) {
    return prefix
  } else {
    return null
  }
  const keepTrailingSlash = prefix.endsWith('/')
  let rel = toPosix(path.relative(path.dirname(importerAbs), targetAbs))
  if (!rel.startsWith('.')) rel = './' + rel
  if (keepTrailingSlash && !rel.endsWith('/')) rel += '/'
  return rel
}

/** dir part + optional file-name prefix to glob covering nested dirs (webpack context is recursive) */
function globPattern(relPrefix, suffix) {
  const slash = relPrefix.lastIndexOf('/')
  const dir = relPrefix.slice(0, slash + 1)
  const filePrefix = relPrefix.slice(slash + 1)
  return dir + '**/' + filePrefix + '*' + suffix
}

function loaderHelper() {
  // const __v23LoadGlob = (map, key) => map[key] ? map[key]() : Promise.reject(new Error('Cannot find module ' + key))
  const map = t.identifier('map')
  const key = t.identifier('key')
  const entry = t.memberExpression(t.identifier('map'), t.identifier('key'), true)
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(LOADER_ID),
      t.arrowFunctionExpression(
        [map, key],
        t.conditionalExpression(
          entry,
          t.callExpression(t.cloneNode(entry, true), []),
          t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('reject')), [
            t.newExpression(t.identifier('Error'), [
              t.binaryExpression('+', t.stringLiteral('Cannot find module '), t.identifier('key')),
            ]),
          ])
        )
      )
    ),
  ])
}

/**
 * @param {string} code
 * @param {{ filename: string, projectRoot?: string }} opts
 */
function migrateDynamicImport(code, opts) {
  const changes = []
  const filename = (opts && opts.filename) || 'anon.js'
  const projectRoot = opts && opts.projectRoot
  if (!/import\s*\(/.test(code)) return { code, changes }
  let ast
  try {
    ast = parser.parse(String(code || ''), {
      sourceType: 'module',
      plugins: BABEL_PLUGINS,
      errorRecovery: true,
    })
  } catch (e) {
    return { code, changes, error: String(e && e.message) }
  }

  const globs = new Map() // pattern -> id
  traverse(ast, {
    CallExpression(p) {
      if (!t.isImport(p.node.callee) || p.node.arguments.length !== 1) return
      const split = splitSpecifier(p.node.arguments[0])
      if (!split) return
      if (!/\.[A-Za-z0-9]+$/.test(split.suffix) || split.suffix.includes('*')) return
      const rel = relativePrefix(split.prefix, filename, projectRoot)
      if (!rel) return
      const pattern = globPattern(rel, split.suffix)
      if (!globs.has(pattern)) globs.set(pattern, '__v23Glob' + globs.size)
      const id = globs.get(pattern)
      p.replaceWith(t.callExpression(t.identifier(LOADER_ID), [t.identifier(id), split.rebuild(rel)]))
      p.skip()
      changes.push({ kind: 'dynamic-import-glob', from: split.prefix, pattern })
    },
  })
  if (!changes.length) return { code, changes }

  const decls = [...globs.entries()].map(([pattern, id]) =>
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(id),
        t.callExpression(
          t.memberExpression(t.metaProperty(t.identifier('import'), t.identifier('meta')), t.identifier('glob')),
          [t.stringLiteral(pattern)]
        )
      ),
    ])
  )
  decls.push(loaderHelper())
  const body = ast.program.body
  const lastImport = [...body].reverse().find((n) => t.isImportDeclaration(n))
  body.splice(lastImport ? body.indexOf(lastImport) + 1 : 0, 0, ...decls)

  return {
    code: generate(ast, { retainLines: false, compact: false, comments: true }, code).code,
    changes,
  }
}

module.exports = { migrateDynamicImport, globPattern, relativePrefix }

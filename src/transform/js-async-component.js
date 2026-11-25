/**
 * Vue2 async component factories → Vue3 defineAsyncComponent.
 *
 * In scope (deterministic):
 * - () => import('…')
 * - () => ({ component: import('…'), loading, error, delay, timeout })
 * - Vue.component('Name', () => import('…'))  (factory only; Vue.component left for other plugins)
 *
 * Out of scope: custom Promise factories / non-import loaders → leave + optional note.
 * Route records (`{ path, component: () => import() }`) are skipped: Vue Router 4 wants plain loaders.
 */
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { isRouteRecordComponent } = require('./js-router')

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

function parse(code, filename) {
  return parser.parse(String(code || ''), {
    sourceType: 'module',
    plugins: BABEL_PLUGINS,
    errorRecovery: true,
    sourceFilename: filename || 'async.js',
  })
}

function isImportCall(node) {
  return t.isCallExpression(node) && t.isImport(node.callee)
}

function isImportFactoryArrow(node) {
  if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) return false
  if (node.params && node.params.length) return false
  const body = node.body
  if (isImportCall(body)) return true
  if (t.isBlockStatement(body) && body.body.length === 1 && t.isReturnStatement(body.body[0])) {
    return isImportCall(body.body[0].argument)
  }
  return false
}

function getImportFromFactory(node) {
  const body = node.body
  if (isImportCall(body)) return body
  if (t.isBlockStatement(body) && body.body.length === 1 && t.isReturnStatement(body.body[0])) {
    return body.body[0].argument
  }
  return null
}

/** () => ({ component: import(), loading, error, delay, timeout }) */
function isAsyncOptionsFactory(node) {
  if (!t.isArrowFunctionExpression(node) && !t.isFunctionExpression(node)) return false
  if (node.params && node.params.length) return false
  let obj = null
  if (t.isObjectExpression(node.body)) obj = node.body
  else if (t.isBlockStatement(node.body) && node.body.body.length === 1 && t.isReturnStatement(node.body.body[0])) {
    if (t.isObjectExpression(node.body.body[0].argument)) obj = node.body.body[0].argument
  }
  if (!obj) return false
  const comp = obj.properties.find(
    (p) =>
      t.isObjectProperty(p) &&
      ((t.isIdentifier(p.key) && p.key.name === 'component') ||
        (t.isStringLiteral(p.key) && p.key.value === 'component'))
  )
  if (!comp || !t.isObjectProperty(comp)) return false
  // component: import()  OR  component: () => import()
  if (isImportCall(comp.value)) return true
  if (isImportFactoryArrow(comp.value)) return true
  return false
}

const ASYNC_OPTION_KEYS = new Set(['component', 'loading', 'error', 'delay', 'timeout'])

// Returns null when the object has spreads / computed or unknown keys so nothing is dropped silently.
function mapAsyncOptionsObject(obj) {
  const lossless = obj.properties.every((p) => {
    if (!t.isObjectProperty(p) || p.computed) return false
    const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null
    return key != null && ASYNC_OPTION_KEYS.has(key)
  })
  if (!lossless) return null
  const props = []
  let loaderExpr = null
  obj.properties.forEach((p) => {
    const key = t.isIdentifier(p.key) ? p.key.name : p.key.value
    if (key === 'component') {
      if (isImportCall(p.value)) {
        loaderExpr = t.arrowFunctionExpression([], p.value)
      } else if (isImportFactoryArrow(p.value)) {
        loaderExpr = p.value
      }
      return
    }
    if (key === 'loading') {
      props.push(t.objectProperty(t.identifier('loadingComponent'), t.cloneNode(p.value, true)))
      return
    }
    if (key === 'error') {
      props.push(t.objectProperty(t.identifier('errorComponent'), t.cloneNode(p.value, true)))
      return
    }
    if (key === 'delay' || key === 'timeout') {
      props.push(t.objectProperty(t.identifier(key), t.cloneNode(p.value, true)))
    }
  })
  if (!loaderExpr) return null
  props.unshift(t.objectProperty(t.identifier('loader'), loaderExpr))
  return t.objectExpression(props)
}

function wrapDefineAsync(argNode) {
  return t.callExpression(t.identifier('defineAsyncComponent'), [argNode])
}

/**
 * Convert a Vue2 async factory node → defineAsyncComponent(...) AST, or null if not matched.
 * Used by options-to-composition when hoisting components.
 */
function toDefineAsyncComponent(node) {
  if (!node) return null
  if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'defineAsyncComponent' })) {
    return node
  }
  if (isImportFactoryArrow(node)) {
    const imp = getImportFromFactory(node)
    if (!imp) return null
    return wrapDefineAsync(t.arrowFunctionExpression([], t.cloneNode(imp, true)))
  }
  if (isAsyncOptionsFactory(node)) {
    let obj = t.isObjectExpression(node.body) ? node.body : null
    if (!obj && t.isBlockStatement(node.body) && node.body.body[0] && t.isReturnStatement(node.body.body[0])) {
      obj = node.body.body[0].argument
    }
    const mapped = obj && mapAsyncOptionsObject(obj)
    if (!mapped) return null
    return wrapDefineAsync(mapped)
  }
  return null
}

/**
 * Skip factories already under defineAsyncComponent(...), including nested
 * `loader: () => import()` — otherwise we re-wrap the loader arrow.
 */
function alreadyWrapped(path) {
  let p = path.parentPath
  while (p) {
    if (p.isCallExpression() && t.isIdentifier(p.node.callee, { name: 'defineAsyncComponent' })) {
      return true
    }
    p = p.parentPath
  }
  return false
}

function ensureDefineAsyncImport(ast) {
  let has = false
  let firstImport = null
  traverse(ast, {
    ImportDeclaration(p) {
      if (!firstImport) firstImport = p
      if (p.node.source.value !== 'vue') return
      p.node.specifiers.forEach((s) => {
        if (t.isImportSpecifier(s) && s.imported.name === 'defineAsyncComponent') has = true
      })
    },
  })
  if (has) return false
  const spec = t.importSpecifier(t.identifier('defineAsyncComponent'), t.identifier('defineAsyncComponent'))
  if (firstImport && firstImport.node.source.value === 'vue') {
    firstImport.node.specifiers.push(spec)
    return true
  }
  const decl = t.importDeclaration([spec], t.stringLiteral('vue'))
  ast.program.body.unshift(decl)
  return true
}

function migrateAsyncComponent(code, filename) {
  const changes = []
  let ast
  try {
    ast = parse(code, filename)
  } catch (e) {
    return { code, changes, error: String(e && e.message) }
  }

  traverse(ast, {
    ArrowFunctionExpression(path) {
      rewriteFactoryPath(path, changes)
    },
    FunctionExpression(path) {
      rewriteFactoryPath(path, changes)
    },
  })

  if (!changes.length) return { code, changes }

  ensureDefineAsyncImport(ast)
  changes.push({ kind: 'import-defineAsyncComponent' })
  const gen = generate(ast, { retainLines: false, compact: false, comments: true }, code)
  return { code: gen.code, changes }
}

function rewriteFactoryPath(path, changes) {
  if (alreadyWrapped(path)) return
  if (isRouteRecordComponent(path)) return
  const node = path.node

  if (isImportFactoryArrow(node)) {
    const imp = getImportFromFactory(node)
    if (!imp) return
    path.replaceWith(wrapDefineAsync(t.arrowFunctionExpression([], t.cloneNode(imp, true))))
    changes.push({ kind: 'async-import-factory', note: '() => import() → defineAsyncComponent' })
    return
  }

  if (isAsyncOptionsFactory(node)) {
    let obj = t.isObjectExpression(node.body) ? node.body : null
    if (!obj && t.isBlockStatement(node.body)) {
      obj = node.body.body[0].argument
    }
    const mapped = mapAsyncOptionsObject(obj)
    if (!mapped) {
      changes.push({
        kind: 'async-factory-skip',
        note: 'async options factory not mapped — custom loader left for AI',
      })
      return
    }
    path.replaceWith(wrapDefineAsync(mapped))
    changes.push({
      kind: 'async-options-factory',
      note: 'component/loading/error → loader/loadingComponent/errorComponent',
    })
  }
}

module.exports = {
  migrateAsyncComponent,
  isImportFactoryArrow,
  isAsyncOptionsFactory,
  toDefineAsyncComponent,
}

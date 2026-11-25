/**
 * Record this rebinding sites: .bind / .call / .apply.
 * Also note the "incoming this" expectation before a function runs
 * (component instance vs foreign object vs lost).
 *
 * Also record this._xxx (underscore) accesses — may be Vue internals or custom fields.
 */
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

const BABEL_PLUGINS = [
  'jsx',
  'classProperties',
  'optionalChaining',
  'nullishCoalescingOperator',
  'objectRestSpread',
  'dynamicImport',
]

/** Common Vue 2 instance internals (not exhaustive). */
const VUE2_INTERNAL_UNDERSCORE = new Set([
  '_uid',
  '_isVue',
  '_self',
  '_data',
  '_props',
  '_renderProxy',
  '_watcher',
  '_watchers',
  '_computedWatchers',
  '_vnode',
  '_staticTrees',
  '_hasHookEvent',
  '_events',
  '_provided',
  '_componentTag',
  '_propsCount',
  '_isMounted',
  '_isDestroyed',
  '_isBeingDestroyed',
  '_inactive',
  '_directInactive',
  '_updateFromParent',
  '_renderChildren',
  '_name',
  '_routerRoot',
])

function parse(code, filename) {
  return parser.parse(String(code || ''), {
    sourceType: 'module',
    plugins: BABEL_PLUGINS,
    errorRecovery: true,
  })
}

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return { line: node.loc.start.line, column: node.loc.start.column }
}

function codeSlice(code, node) {
  if (!node || node.start == null || node.end == null) return ''
  return String(code).slice(node.start, node.end)
}

function thisArgKind(node) {
  if (!node) return 'implicit'
  if (t.isThisExpression(node)) return 'component-this'
  if (t.isNullLiteral(node)) return 'null'
  if (t.isIdentifier(node) && node.name === 'undefined') return 'undefined'
  return 'foreign'
}

function calleeMethodName(callee) {
  // obj.foo.call(...) to foo ; this.foo.bind(...) to foo
  if (!t.isMemberExpression(callee)) return null
  const obj = callee.object
  if (t.isMemberExpression(obj) && t.isIdentifier(obj.property) && !obj.computed) {
    return obj.property.name
  }
  if (t.isIdentifier(obj)) return obj.name
  return null
}

/**
 * @returns {{
 *   sites: Array<{
 *     kind: 'bind'|'call'|'apply',
 *     methodHint: string|null,
 *     thisArgKind: string,
 *     thisArgCode: string,
 *     incomingThis: 'component'|'foreign'|'lost',
 *     loc: object|null,
 *     evidence: string,
 *   }>,
 *   borrowedMethods: Set<string>,
 * }}
 */
function analyzeThisRebinding(code, filename) {
  const sites = []
  const borrowedMethods = new Set()
  let ast
  try {
    ast = parse(code, filename || 'anon.js')
  } catch (e) {
    return { sites, borrowedMethods }
  }

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee
      if (!t.isMemberExpression(callee) || callee.computed) return
      if (!t.isIdentifier(callee.property)) return
      const kind = callee.property.name
      if (kind !== 'bind' && kind !== 'call' && kind !== 'apply') return

      const thisArg = path.node.arguments[0]
      const argKind = thisArgKind(thisArg)
      let incomingThis = 'component'
      if (argKind === 'null' || argKind === 'undefined') incomingThis = 'lost'
      else if (argKind === 'foreign') incomingThis = 'foreign'
      else if (argKind === 'component-this') incomingThis = 'component'

      const methodHint = calleeMethodName(callee)
      const evidence = codeSlice(code, path.node)

      sites.push({
        kind,
        methodHint,
        thisArgKind: argKind,
        thisArgCode: codeSlice(code, thisArg),
        incomingThis,
        loc: locOf(path.node),
        evidence: evidence.slice(0, 120),
      })

      // Non-component thisArg ⇒ that method may be borrowed
      if (incomingThis !== 'component' && methodHint) {
        borrowedMethods.add(methodHint)
      }
    },
  })

  return { sites, borrowedMethods }
}

/**
 * Collect this._xxx member accesses for AI review (custom vs Vue internal).
 * Does not rewrite — analysis only.
 */
function analyzeThisUnderscore(code, filename) {
  const sites = []
  let ast
  try {
    ast = parse(code, filename || 'anon.js')
  } catch (e) {
    return { sites }
  }

  traverse(ast, {
    MemberExpression(path) {
      if (!t.isThisExpression(path.node.object)) return
      if (path.node.computed) {
        // this['_foo'] 
        if (t.isStringLiteral(path.node.property) && path.node.property.value.charAt(0) === '_') {
          const name = path.node.property.value
          sites.push({
            name,
            kind: VUE2_INTERNAL_UNDERSCORE.has(name) ? 'vue-internal' : 'custom-or-unknown',
            computed: true,
            loc: locOf(path.node),
            evidence: codeSlice(code, path.node).slice(0, 80),
          })
        }
        return
      }
      if (!t.isIdentifier(path.node.property)) return
      const name = path.node.property.name
      if (name.charAt(0) !== '_') return
      sites.push({
        name,
        kind: VUE2_INTERNAL_UNDERSCORE.has(name) ? 'vue-internal' : 'custom-or-unknown',
        computed: false,
        loc: locOf(path.node),
        evidence: codeSlice(code, path.node).slice(0, 80),
      })
    },
  })

  return { sites }
}

module.exports = {
  analyzeThisRebinding,
  analyzeThisUnderscore,
  thisArgKind,
  VUE2_INTERNAL_UNDERSCORE,
}

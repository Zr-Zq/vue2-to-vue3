const traverse = require('@babel/traverse').default
const t = require('@babel/types')

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return { line: node.loc.start.line, column: node.loc.start.column }
}

function memberChain(node) {
  const parts = []
  let cur = node
  while (t.isMemberExpression(cur)) {
    if (t.isIdentifier(cur.property) && !cur.computed) {
      parts.unshift(cur.property.name)
    } else if (t.isStringLiteral(cur.property)) {
      parts.unshift(cur.property.value)
    } else {
      parts.unshift('[…]')
    }
    cur = cur.object
  }
  if (t.isIdentifier(cur)) parts.unshift(cur.name)
  else if (t.isThisExpression(cur)) parts.unshift('this')
  else return null
  return parts
}

function argPreview(node, maxLen) {
  if (!node) return null
  if (t.isStringLiteral(node)) return node.value
  if (t.isIdentifier(node)) return node.name
  if (t.isBooleanLiteral(node)) return String(node.value)
  if (t.isNumericLiteral(node)) return String(node.value)
  if (t.isObjectExpression(node)) return '{…}'
  if (t.isArrayExpression(node)) return '[…]'
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return '<fn>'
  if (t.isMemberExpression(node)) {
    const chain = memberChain(node)
    return chain ? chain.join('.') : '<expr>'
  }
  return '<expr>'
}

/**
 * Record registration / mutation sites (not call sites):
 * - Vue.prototype.x = …
 * - Vue.component / directive / filter / mixin / use / extend
 * - Vue.config.*
 * - app.config.globalProperties (Vue3 reserved)
 * - window.xxx = … / globalThis.xxx
 * - Object.defineProperty(Vue.prototype / window, …)
 */
function analyzeGlobals(ast, meta) {
  const records = []
  if (!ast) return records

  function push(rec) {
    records.push(
      Object.assign(
        {
          file: meta.fileRel,
          scriptId: meta.scriptId,
          loc: null,
        },
        rec
      )
    )
  }

  traverse(ast, {
    AssignmentExpression(p) {
      const left = p.node.left
      if (!t.isMemberExpression(left)) return
      const chain = memberChain(left)
      if (!chain || chain.length < 2) return

      // Vue.prototype.xxx / Vue.prototype
      if (chain[0] === 'Vue' && chain[1] === 'prototype' && chain.length >= 3) {
        push({
          kind: 'vue.prototype',
          api: 'Vue.prototype.' + chain.slice(2).join('.'),
          name: chain.slice(2).join('.'),
          action: 'assign',
          valueHint: argPreview(p.node.right),
          loc: locOf(p.node),
        })
        return
      }

      // Vue.config.xxx
      if (chain[0] === 'Vue' && chain[1] === 'config') {
        push({
          kind: 'vue.config',
          api: chain.join('.'),
          name: chain.slice(2).join('.') || 'config',
          action: 'assign',
          valueHint: argPreview(p.node.right),
          loc: locOf(p.node),
        })
        return
      }

      // window.xxx / globalThis.xxx / global.xxx
      if (
        (chain[0] === 'window' || chain[0] === 'globalThis' || chain[0] === 'global') &&
        chain.length >= 2
      ) {
        // Skip common noise: window.location / document — only record assignments to new properties
        const skip = new Set(['location', 'document', 'history', 'navigator', 'localStorage', 'sessionStorage'])
        if (skip.has(chain[1])) return
        push({
          kind: 'window',
          api: chain.join('.'),
          name: chain.slice(1).join('.'),
          action: 'assign',
          valueHint: argPreview(p.node.right),
          loc: locOf(p.node),
        })
      }
    },

    CallExpression(p) {
      const callee = p.node.callee
      const args = p.node.arguments || []

      // Vue.component / directive / filter / mixin / use / extend / observable / set / delete
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: 'Vue' }) && t.isIdentifier(callee.property)) {
        const method = callee.property.name
        const registryMethods = {
          component: 'vue.component',
          directive: 'vue.directive',
          filter: 'vue.filter',
          mixin: 'vue.mixin',
          use: 'vue.use',
          extend: 'vue.extend',
          observable: 'vue.observable',
          set: 'vue.set',
          delete: 'vue.delete',
          nextTick: null, // Call site, not registration — skip
          compile: null,
          version: null,
        }
        if (!(method in registryMethods) || registryMethods[method] === null) {
          // Other Vue.xxx calls are ignored here; use/mixin etc. are recorded above
        }
        const kind = registryMethods[method]
        if (kind) {
          const name =
            method === 'mixin' || method === 'use' || method === 'extend'
              ? argPreview(args[0])
              : argPreview(args[0]) || method
          push({
            kind,
            api: 'Vue.' + method,
            name: name != null ? String(name) : method,
            action: 'register',
            valueHint: args.length > 1 ? argPreview(args[1]) : null,
            argCount: args.length,
            loc: locOf(p.node),
          })
          return
        }
      }

      // Vue.prototype.$xxx = via Object.assign(Vue.prototype, {…})
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'Object' }) &&
        t.isIdentifier(callee.property, { name: 'assign' }) &&
        args.length >= 2
      ) {
        const target = args[0]
        const chain = t.isMemberExpression(target) ? memberChain(target) : null
        if (chain && chain[0] === 'Vue' && chain[1] === 'prototype') {
          if (t.isObjectExpression(args[1])) {
            args[1].properties.forEach((prop) => {
              if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
              const key = t.isIdentifier(prop.key)
                ? prop.key.name
                : t.isStringLiteral(prop.key)
                  ? prop.key.value
                  : null
              if (!key) return
              push({
                kind: 'vue.prototype',
                api: 'Vue.prototype.' + key,
                name: key,
                action: 'assign-via-Object.assign',
                valueHint: t.isObjectMethod(prop) ? '<fn>' : argPreview(prop.value),
                loc: locOf(prop),
              })
            })
          } else {
            push({
              kind: 'vue.prototype',
              api: 'Vue.prototype.*',
              name: '*',
              action: 'assign-via-Object.assign',
              valueHint: argPreview(args[1]),
              loc: locOf(p.node),
            })
          }
          return
        }
      }

      // Object.defineProperty(Vue.prototype, 'x', …) / window
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'Object' }) &&
        t.isIdentifier(callee.property, { name: 'defineProperty' }) &&
        args.length >= 2
      ) {
        const target = args[0]
        const chain = t.isMemberExpression(target) ? memberChain(target) : null
        const propName = t.isStringLiteral(args[1])
          ? args[1].value
          : t.isIdentifier(args[1])
            ? args[1].name
            : argPreview(args[1])
        if (chain && chain[0] === 'Vue' && chain[1] === 'prototype') {
          push({
            kind: 'vue.prototype',
            api: 'Vue.prototype.' + propName,
            name: String(propName),
            action: 'defineProperty',
            loc: locOf(p.node),
          })
        } else if (chain && (chain[0] === 'window' || chain[0] === 'globalThis')) {
          push({
            kind: 'window',
            api: chain[0] + '.' + propName,
            name: String(propName),
            action: 'defineProperty',
            loc: locOf(p.node),
          })
        }
      }

      // app.config.globalProperties.xxx = … handled in Assignment; catch .component/.use after createApp
      // app.component / app.use / app.directive / app.mixin (Vue3)
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
        const method = callee.property.name
        const vue3 = ['component', 'directive', 'mixin', 'use', 'provide']
        if (vue3.includes(method) && t.isIdentifier(callee.object)) {
          // Heuristic: object name contains "app"
          const obj = callee.object.name
          if (/app/i.test(obj) && obj !== 'Vue') {
            push({
              kind: 'vue3.app.' + method,
              api: obj + '.' + method,
              name: argPreview(args[0]) != null ? String(argPreview(args[0])) : method,
              action: 'register',
              valueHint: args.length > 1 ? argPreview(args[1]) : null,
              loc: locOf(p.node),
            })
          }
        }
      }
    },
  })

  return records
}

/**
 * Aggregate by api/name: which files registered the same global
 */
function indexGlobals(records) {
  const byKey = new Map()
  records.forEach((r) => {
    const key = r.kind + '::' + r.name
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        kind: r.kind,
        name: r.name,
        api: r.api,
        registrations: [],
      })
    }
    byKey.get(key).registrations.push({
      file: r.file,
      scriptId: r.scriptId,
      action: r.action,
      valueHint: r.valueHint,
      loc: r.loc,
    })
  })
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key))
}

module.exports = {
  analyzeGlobals,
  indexGlobals,
}

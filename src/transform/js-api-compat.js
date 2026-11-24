/**
 * Deterministic JS API compatibility rewrites:
 * - beforeDestroy → beforeUnmount / destroyed → unmounted
 * - this.$set / Vue.set → direct assignment
 * - this.$delete / Vue.delete → delete
 * - this.$listeners → this.$attrs
 * - this.$scopedSlots → this.$slots (whole file, not only render)
 * - Remove Vue.config.productionTip / silent assignments
 */
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

const LIFECYCLE = {
  beforeDestroy: 'beforeUnmount',
  destroyed: 'unmounted',
}

function renameLifecycleKey(keyNode) {
  if (t.isIdentifier(keyNode) && LIFECYCLE[keyNode.name]) {
    const next = LIFECYCLE[keyNode.name]
    keyNode.name = next
    return next
  }
  if (t.isStringLiteral(keyNode) && LIFECYCLE[keyNode.value]) {
    const next = LIFECYCLE[keyNode.value]
    keyNode.value = next
    return next
  }
  return null
}

function isVueOrThisSetDelete(callee, names) {
  if (!t.isMemberExpression(callee) || callee.computed) return null
  if (!t.isIdentifier(callee.property)) return null
  const prop = callee.property.name
  if (!names.has(prop)) return null
  if (t.isThisExpression(callee.object)) return prop
  if (t.isIdentifier(callee.object, { name: 'Vue' })) return prop
  return null
}

function toAssignFromSet(args) {
  if (!args || args.length < 3) return null
  const obj = args[0]
  const key = args[1]
  const val = args[2]
  let left
  if (t.isStringLiteral(key) && /^[A-Za-z_$][\w$]*$/.test(key.value)) {
    left = t.memberExpression(obj, t.identifier(key.value))
  } else {
    left = t.memberExpression(obj, key, true)
  }
  return t.assignmentExpression('=', left, val)
}

function toDeleteFromDelete(args) {
  if (!args || args.length < 2) return null
  const obj = args[0]
  const key = args[1]
  let arg
  if (t.isStringLiteral(key) && /^[A-Za-z_$][\w$]*$/.test(key.value)) {
    arg = t.memberExpression(obj, t.identifier(key.value))
  } else {
    arg = t.memberExpression(obj, key, true)
  }
  return t.unaryExpression('delete', arg, true)
}

function migrateApiCompat(code, filename) {
  const changes = []
  let ast
  try {
    ast = parseJs(code, filename || 'api.js')
  } catch (e) {
    // Fallback: plain-text lifecycle / listeners (when parse fails)
    return migrateApiCompatText(code)
  }

  const setNames = new Set(['$set', 'set'])
  const delNames = new Set(['$delete', 'delete'])

  traverse(ast, {
    ObjectMethod(p) {
      const next = renameLifecycleKey(p.node.key)
      if (next) changes.push({ kind: 'lifecycle', to: next })
    },
    ObjectProperty(p) {
      const next = renameLifecycleKey(p.node.key)
      if (next) changes.push({ kind: 'lifecycle', to: next })
    },
    MemberExpression(p) {
      if (p.node.computed || !t.isIdentifier(p.node.property)) return
      const prop = p.node.property.name
      if (prop === '$listeners') {
        p.node.property.name = '$attrs'
        changes.push({ kind: 'listeners-to-attrs' })
      } else if (prop === '$scopedSlots') {
        p.node.property.name = '$slots'
        changes.push({ kind: 'scopedSlots-to-slots' })
      }
    },
    CallExpression(p) {
      const kind = isVueOrThisSetDelete(p.node.callee, setNames)
      if (kind === '$set' || (kind === 'set' && t.isIdentifier(p.node.callee.object, { name: 'Vue' }))) {
        const assign = toAssignFromSet(p.node.arguments)
        if (assign) {
          p.replaceWith(assign)
          changes.push({ kind: 'set-to-assign' })
        }
        return
      }
      const dkind = isVueOrThisSetDelete(p.node.callee, delNames)
      if (
        dkind === '$delete' ||
        (dkind === 'delete' && t.isIdentifier(p.node.callee.object, { name: 'Vue' }))
      ) {
        const del = toDeleteFromDelete(p.node.arguments)
        if (del) {
          p.replaceWith(del)
          changes.push({ kind: 'delete-to-op' })
        }
      }
    },
    AssignmentExpression(p) {
      // Vue.config.productionTip = ... / Vue.config.silent = ...
      const left = p.node.left
      if (
        t.isMemberExpression(left) &&
        t.isMemberExpression(left.object) &&
        t.isIdentifier(left.object.object, { name: 'Vue' }) &&
        t.isIdentifier(left.object.property, { name: 'config' }) &&
        t.isIdentifier(left.property) &&
        (left.property.name === 'productionTip' || left.property.name === 'silent')
      ) {
        const stmt = p.parentPath
        if (stmt.isExpressionStatement()) {
          stmt.remove()
          changes.push({ kind: 'remove-config-' + left.property.name })
        }
      }
    },
  })

  if (!changes.length) return { code, changes }

  const gen = generate(ast, { retainLines: true, compact: false, comments: true }, code)
  return { code: gen.code, changes }
}

function migrateApiCompatText(code) {
  const changes = []
  let out = String(code || '')
  out = out.replace(/\bbeforeDestroy\b/g, () => {
    changes.push({ kind: 'lifecycle-text', to: 'beforeUnmount' })
    return 'beforeUnmount'
  })
  out = out.replace(/\bdestroyed\b(?!\s*\()/g, (m, off, src) => {
    // Avoid false positives like destroyedXxx; only hit when used as method keys (approx)
    const before = src.slice(Math.max(0, off - 20), off)
    if (/function\s*$/.test(before) || /[,{\s]$/.test(before) || /:\s*$/.test(before)) {
      changes.push({ kind: 'lifecycle-text', to: 'unmounted' })
      return 'unmounted'
    }
    return m
  })
  out = out.replace(/\.\$listeners\b/g, () => {
    changes.push({ kind: 'listeners-to-attrs' })
    return '.$attrs'
  })
  out = out.replace(/\.\$scopedSlots\b/g, () => {
    changes.push({ kind: 'scopedSlots-to-slots' })
    return '.$slots'
  })
  return { code: out, changes }
}

module.exports = {
  migrateApiCompat,
  migrateApiCompatText,
  LIFECYCLE,
}

/**
 * 自定义指令钩子名 Vue2 → Vue3（确定性映射）
 * bind → beforeMount
 * inserted → mounted
 * update → beforeUpdate
 * componentUpdated → updated
 * unbind → unmounted
 */
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

const HOOK_MAP = {
  bind: 'beforeMount',
  inserted: 'mounted',
  update: 'beforeUpdate',
  componentUpdated: 'updated',
  unbind: 'unmounted',
}

function renameHookKey(keyNode) {
  let name = null
  if (t.isIdentifier(keyNode)) name = keyNode.name
  else if (t.isStringLiteral(keyNode)) name = keyNode.value
  if (!name || !HOOK_MAP[name]) return null
  const next = HOOK_MAP[name]
  if (t.isIdentifier(keyNode)) keyNode.name = next
  else keyNode.value = next
  return next
}

function rewriteDirectiveObject(objExpr, changes) {
  if (!t.isObjectExpression(objExpr)) return
  objExpr.properties.forEach((prop) => {
    if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
    const next = renameHookKey(prop.key)
    if (next) changes.push({ kind: 'directive-hook', to: next })
  })
}

function migrateDirectiveHooks(code, filename) {
  const changes = []
  let ast
  try {
    ast = parseJs(code, filename || 'dir.js')
  } catch (e) {
    // 解析失败不盲改（bind/update 太易误伤）
    return { code, changes, error: e.message }
  }

  traverse(ast, {
    ObjectProperty(p) {
      const keyIsDirectives =
        (t.isIdentifier(p.node.key) && p.node.key.name === 'directives') ||
        (t.isStringLiteral(p.node.key) && p.node.key.value === 'directives')
      if (!keyIsDirectives || !t.isObjectExpression(p.node.value)) return
      p.node.value.properties.forEach((dirProp) => {
        if (!t.isObjectProperty(dirProp)) return
        rewriteDirectiveObject(dirProp.value, changes)
      })
    },
    CallExpression(p) {
      const callee = p.node.callee
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.object, { name: 'Vue' }) ||
        !t.isIdentifier(callee.property, { name: 'directive' })
      ) {
        return
      }
      const def = p.node.arguments[1]
      if (t.isObjectExpression(def)) rewriteDirectiveObject(def, changes)
    },
  })

  if (!changes.length) return { code, changes }
  const gen = generate(ast, { retainLines: true, compact: false, comments: true }, code)
  return { code: gen.code, changes }
}

function migrateDirectiveHooksText(code) {
  const changes = []
  let out = String(code || '')
  Object.keys(HOOK_MAP).forEach((from) => {
    const re = new RegExp('(\\b)' + from + '(\\s*\\()', 'g')
    out = out.replace(re, (m, a, b) => {
      // 仅在像钩子定义时：行首/逗号/空白后的 bind(el
      changes.push({ kind: 'directive-hook-text', to: HOOK_MAP[from] })
      return a + HOOK_MAP[from] + b
    })
  })
  return { code: out, changes }
}

module.exports = {
  migrateDirectiveHooks,
  HOOK_MAP,
}

/**
 * options.filters → 合并进 methods（Vue3 无 filters）
 * 模板侧 | 已由 html-filters 改成函数调用，需能在 methods 里找到同名函数。
 */
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

function migrateFiltersOption(code, filename) {
  const changes = []
  let ast
  try {
    ast = parseJs(code, filename || 'filters.js')
  } catch (e) {
    return { code, changes, error: e.message }
  }

  let filtersNode = null
  let filtersPath = null
  let methodsNode = null
  let methodsPath = null
  let rootObj = null

  // 找 export default { ... } 或 Vue 组件选项对象里的 filters / methods
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      if (t.isObjectExpression(p.node.declaration)) rootObj = p.node.declaration
    },
    ObjectProperty(p) {
      // 只处理顶层 options（父级是 rootObj 或 CallExpression defineComponent/Vue.extend 参数）
      const key =
        t.isIdentifier(p.node.key) ? p.node.key.name : t.isStringLiteral(p.node.key) ? p.node.key.value : null
      if (!key) return
      const parentObj = p.parentPath && p.parentPath.node
      if (!t.isObjectExpression(parentObj)) return

      // 启发式：含 filters 的对象即组件选项
      if (key === 'filters' && t.isObjectExpression(p.node.value)) {
        filtersNode = p.node.value
        filtersPath = p
      }
      if (key === 'methods' && t.isObjectExpression(p.node.value)) {
        methodsNode = p.node.value
        methodsPath = p
      }
    },
  })

  if (!filtersNode || !filtersPath) return { code, changes }

  const filterProps = filtersNode.properties.slice()
  if (!filterProps.length) {
    filtersPath.remove()
    changes.push({ kind: 'filters-remove-empty' })
  } else if (methodsNode) {
    // 合并：同名跳过（保留 methods）
    const existing = new Set()
    methodsNode.properties.forEach((prop) => {
      const k = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null
      if (k) existing.add(k)
    })
    filterProps.forEach((prop) => {
      const k = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null
      if (k && existing.has(k)) {
        changes.push({ kind: 'filters-skip-dup', name: k })
        return
      }
      methodsNode.properties.push(prop)
      changes.push({ kind: 'filters-to-methods', name: k || '?' })
    })
    filtersPath.remove()
  } else {
    // 无 methods：把 filters 键改名为 methods
    if (t.isIdentifier(filtersPath.node.key)) filtersPath.node.key.name = 'methods'
    else if (t.isStringLiteral(filtersPath.node.key)) filtersPath.node.key.value = 'methods'
    changes.push({ kind: 'filters-rename-methods' })
  }

  if (!changes.length) return { code, changes }
  const gen = generate(ast, { retainLines: true, compact: false, comments: true }, code)
  return { code: gen.code, changes }
}

module.exports = {
  migrateFiltersOption,
}

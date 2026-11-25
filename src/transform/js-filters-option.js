/**
 * options.filters → merge into methods (Vue3 has no filters).
 * Template | is already rewritten to calls by html-filters.
 *
 * Collision policy:
 * - Vue2 keeps filters and methods in separate namespaces.
 * - On the same key, keep the method as-is and merge the filter as
 *   `__v23Filter_<name>` (stable, unlikely to collide).
 * - Call sites from pipes live only in mustache / v-bind; migrate-filters
 *   rewrites those to the alias. Event handlers that called the method stay.
 */
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

const FILTER_ALIAS_PREFIX = '__v23Filter_'

function filterAlias(name) {
  return FILTER_ALIAS_PREFIX + String(name || '')
}

function propKeyName(prop) {
  if (!prop) return null
  if (prop.computed) return null
  if (t.isIdentifier(prop.key)) return prop.key.name
  if (t.isStringLiteral(prop.key)) return prop.key.value
  return null
}

function withPropKey(prop, newName) {
  const next = t.cloneNode(prop, true)
  next.key = t.identifier(newName)
  next.computed = false
  if (t.isObjectProperty(next)) next.shorthand = false
  return next
}

function migrateFiltersOption(code, filename) {
  const changes = []
  const renames = Object.create(null)
  let ast
  try {
    ast = parseJs(code, filename || 'filters.js')
  } catch (e) {
    return { code, changes, renames, error: e.message }
  }

  let filtersNode = null
  let filtersPath = null
  let methodsNode = null

  traverse(ast, {
    ObjectProperty(p) {
      const key = propKeyName(p.node)
      if (!key) return
      const parentObj = p.parentPath && p.parentPath.node
      if (!t.isObjectExpression(parentObj)) return

      if (key === 'filters' && t.isObjectExpression(p.node.value)) {
        filtersNode = p.node.value
        filtersPath = p
      }
      if (key === 'methods' && t.isObjectExpression(p.node.value)) {
        methodsNode = p.node.value
      }
    },
  })

  if (!filtersNode || !filtersPath) return { code, changes, renames }

  const filterProps = filtersNode.properties.slice()
  if (!filterProps.length) {
    filtersPath.remove()
    changes.push({ kind: 'filters-remove-empty' })
  } else if (methodsNode) {
    const existing = new Set()
    methodsNode.properties.forEach((prop) => {
      const k = propKeyName(prop)
      if (k) existing.add(k)
    })
    filterProps.forEach((prop) => {
      const k = propKeyName(prop)
      if (!k) {
        methodsNode.properties.push(prop)
        changes.push({ kind: 'filters-to-methods', name: '?' })
        return
      }
      if (existing.has(k)) {
        let alias = filterAlias(k)
        let n = 2
        while (existing.has(alias)) {
          alias = filterAlias(k) + '_' + n
          n += 1
        }
        methodsNode.properties.push(withPropKey(prop, alias))
        existing.add(alias)
        renames[k] = alias
        changes.push({
          kind: 'filters-rename-dup',
          from: k,
          to: alias,
          note: 'method kept; filter stored as ' + alias,
        })
        return
      }
      methodsNode.properties.push(prop)
      existing.add(k)
      changes.push({ kind: 'filters-to-methods', name: k })
    })
    filtersPath.remove()
  } else {
    if (t.isIdentifier(filtersPath.node.key)) filtersPath.node.key.name = 'methods'
    else if (t.isStringLiteral(filtersPath.node.key)) filtersPath.node.key.value = 'methods'
    changes.push({ kind: 'filters-rename-methods' })
  }

  if (!changes.length) return { code, changes, renames }
  const gen = generate(ast, { retainLines: true, compact: false, comments: true }, code)
  return { code: gen.code, changes, renames }
}

module.exports = {
  migrateFiltersOption,
  filterAlias,
  FILTER_ALIAS_PREFIX,
  withPropKey,
  propKeyName,
}

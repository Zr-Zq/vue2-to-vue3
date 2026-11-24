const traverse = require('@babel/traverse').default
const t = require('@babel/types')

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return {
    line: node.loc.start.line,
    column: node.loc.start.column,
    endLine: node.loc.end ? node.loc.end.line : null,
  }
}

function layerFor(bindingKind, isModule) {
  if (bindingKind === 'module') return 'file-top-import'
  if (isModule) return 'file-top-decl'
  return 'function-local-decl'
}

function scopeTypeName(block, isModule) {
  if (isModule || t.isProgram(block)) return { type: 'module', name: '<module>' }
  if (
    t.isFunctionDeclaration(block) ||
    t.isFunctionExpression(block) ||
    t.isArrowFunctionExpression(block) ||
    t.isObjectMethod(block) ||
    t.isClassMethod(block)
  ) {
    const name =
      (block.id && block.id.name) ||
      (block.key && t.isIdentifier(block.key) && block.key.name) ||
      '<anonymous>'
    return { type: 'function', name }
  }
  if (t.isCatchClause(block)) return { type: 'catch', name: '<catch>' }
  if (t.isBlockStatement(block)) return { type: 'block', name: '<block>' }
  if (t.isForStatement(block) || t.isForInStatement(block) || t.isForOfStatement(block)) {
    return { type: 'block', name: '<for>' }
  }
  if (t.isSwitchStatement(block)) return { type: 'block', name: '<switch>' }
  return { type: 'block', name: '<scope>' }
}

/**
 * 基于 Babel Scope bindings 构建作用域树。
 * layer:
 * - file-top-import  文件顶层导入
 * - file-top-decl    文件顶部声明
 * - function-local-decl 函数/块内声明（含遮蔽）
 */
function analyzeScopes(ast) {
  const empty = {
    id: 'module',
    type: 'module',
    name: '<module>',
    loc: null,
    bindings: [],
    children: [],
  }
  if (!ast) return empty

  let seq = 0
  const scopeNodeByBabel = new WeakMap()

  function makeNode(babelScope, isModule) {
    if (scopeNodeByBabel.has(babelScope)) return scopeNodeByBabel.get(babelScope)
    const meta = scopeTypeName(babelScope.block, isModule)
    const node = {
      id: meta.type + '-' + String(++seq),
      type: meta.type,
      name: meta.name,
      loc: locOf(babelScope.block),
      bindings: [],
      children: [],
    }

    Object.keys(babelScope.bindings).forEach((bname) => {
      const b = babelScope.bindings[bname]
      let shadowed = null
      let parent = babelScope.parent
      while (parent) {
        if (parent.bindings[bname]) {
          shadowed = { kind: parent.bindings[bname].kind, note: 'shadows-outer' }
          break
        }
        parent = parent.parent
      }
      node.bindings.push({
        name: bname,
        kind: b.kind,
        layer: layerFor(b.kind, meta.type === 'module'),
        constant: !!b.constant,
        referenced: !!b.referenced,
        references: b.references || 0,
        loc: locOf(b.identifier || (b.path && b.path.node)),
        shadowed,
      })
    })

    scopeNodeByBabel.set(babelScope, node)
    return node
  }

  let programPath = null
  traverse(ast, {
    Program(p) {
      programPath = p
      p.stop()
    },
  })
  if (!programPath) return empty

  const root = makeNode(programPath.scope, true)
  root.id = 'module'
  root.type = 'module'
  root.name = '<module>'

  // 收集所有有独立 scope 的节点，挂到父 scope 节点下
  const seen = new WeakSet()
  seen.add(programPath.scope)

  programPath.traverse({
    enter(p) {
      // 只处理创建了新 scope 的节点
      if (!p.scope || p.scope === p.parentPath.scope) return
      if (seen.has(p.scope)) return
      // 跳过 Program
      if (t.isProgram(p.node)) return
      seen.add(p.scope)

      const childNode = makeNode(p.scope, false)
      // 找最近已建的父 scope 节点
      let parentScope = p.scope.parent
      let parentNode = null
      while (parentScope) {
        if (scopeNodeByBabel.has(parentScope)) {
          parentNode = scopeNodeByBabel.get(parentScope)
          break
        }
        parentScope = parentScope.parent
      }
      if (parentNode) {
        // 避免重复挂载
        if (!parentNode.children.includes(childNode)) {
          parentNode.children.push(childNode)
        }
      }
    },
  })

  return root
}

function flattenScopes(scopeTree, fileRel) {
  const rows = []
  function walk(scope, depth) {
    ;(scope.bindings || []).forEach((b) => {
      rows.push({
        file: fileRel,
        scopeId: scope.id,
        scopeType: scope.type,
        scopeName: scope.name,
        depth,
        name: b.name,
        kind: b.kind,
        layer: b.layer,
        shadowed: !!b.shadowed,
        loc: b.loc,
      })
    })
    ;(scope.children || []).forEach((c) => walk(c, depth + 1))
  }
  walk(scopeTree, 0)
  return rows
}

module.exports = {
  analyzeScopes,
  flattenScopes,
}

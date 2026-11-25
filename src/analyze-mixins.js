const traverse = require('@babel/traverse').default
const t = require('@babel/types')

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return { line: node.loc.start.line, column: node.loc.start.column }
}

function objectKeys(objExpr) {
  const keys = []
  if (!objExpr || !t.isObjectExpression(objExpr)) return keys
  objExpr.properties.forEach((prop) => {
    if (t.isSpreadElement(prop)) {
      keys.push({ name: '…spread', kind: 'spread', loc: locOf(prop) })
      return
    }
    if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
    const name = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null
    if (!name) return
    keys.push({
      name,
      kind: t.isObjectMethod(prop) ? prop.kind || 'method' : 'property',
      loc: locOf(prop.key || prop),
    })
  })
  return keys
}

/**
 * Extract injectable members from a mixin object literal
 */
function extractMixinMembersFromObject(objExpr) {
  const members = []
  if (!objExpr || !t.isObjectExpression(objExpr)) return members

  objExpr.properties.forEach((prop) => {
    if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
    const section = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null
    if (!section) return

    if (section === 'methods' || section === 'computed' || section === 'filters' || section === 'watch' || section === 'props' || section === 'inject' || section === 'components' || section === 'directives') {
      const value = t.isObjectMethod(prop) ? null : prop.value
      if (t.isObjectExpression(value)) {
        objectKeys(value).forEach((k) => {
          members.push({
            name: k.name,
            section,
            loc: k.loc,
          })
        })
      } else if (t.isArrayExpression(value) && section === 'props') {
        value.elements.forEach((el) => {
          if (t.isStringLiteral(el)) {
            members.push({ name: el.value, section: 'props', loc: locOf(el) })
          }
        })
      }
    } else if (section === 'data') {
      // data() { return { a, b } } or data: () => ({…})
      const fn = t.isObjectMethod(prop)
        ? prop
        : t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)
          ? prop.value
          : null
      if (fn) {
        let returned = null
        if (t.isArrowFunctionExpression(fn) && t.isObjectExpression(fn.body)) {
          returned = fn.body
        } else {
          const body = t.isObjectMethod(fn) ? fn.body : fn.body
          if (body && body.body) {
            body.body.forEach((stmt) => {
              if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                returned = stmt.argument
              }
            })
          }
        }
        if (returned) {
          objectKeys(returned).forEach((k) => {
            members.push({ name: k.name, section: 'data', loc: k.loc })
          })
        }
      }
    } else if (
      [
        'created',
        'mounted',
        'beforeCreate',
        'beforeMount',
        'beforeDestroy',
        'destroyed',
        'beforeUpdate',
        'updated',
        'activated',
        'deactivated',
        'errorCaptured',
      ].includes(section)
    ) {
      members.push({ name: section, section: 'lifecycle', loc: locOf(prop.key || prop) })
    }
  })

  return members
}

/**
 * Resolve local binding name to import source (file-relative path)
 */
function resolveLocalToImport(localName, imports) {
  if (!localName || !imports) return null
  for (let i = 0; i < imports.length; i += 1) {
    const imp = imports[i]
    const specs = imp.specifiers || []
    for (let j = 0; j < specs.length; j += 1) {
      if (specs[j].local === localName) {
        return {
          source: imp.source,
          resolved: imp.to || null,
          imported: specs[j].imported,
          external: !!imp.external,
        }
      }
    }
  }
  return null
}

/**
 * Collect mixin "applications" in this file:
 * - Vue.mixin(x) / app.mixin(x) to global
 * - mixins: [a, b, createX()] to local
 */
function analyzeMixinApplications(ast, meta, imports) {
  const apps = []
  if (!ast) return apps

  function pushApp(rec) {
    const local = rec.localName
    const resolved = local ? resolveLocalToImport(local, imports) : null
    apps.push(
      Object.assign(
        {
          file: meta.fileRel,
          scriptId: meta.scriptId,
          scope: 'local', // global | local
          localName: local || null,
          mixinSource: resolved ? resolved.source : null,
          mixinFile: resolved && !resolved.external ? resolved.resolved : null,
          factory: false,
          loc: null,
        },
        rec,
        resolved
          ? {
              mixinSource: resolved.source,
              mixinFile: resolved.external ? null : resolved.resolved,
              externalMixin: resolved.external,
            }
          : {}
      )
    )
  }

  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee
      const args = p.node.arguments || []
      // Vue.mixin(x)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'Vue' }) &&
        t.isIdentifier(callee.property, { name: 'mixin' }) &&
        args[0]
      ) {
        const arg = args[0]
        if (t.isIdentifier(arg)) {
          pushApp({
            scope: 'global',
            localName: arg.name,
            loc: locOf(p.node),
          })
        } else if (t.isObjectExpression(arg)) {
          pushApp({
            scope: 'global',
            localName: null,
            inline: true,
            members: extractMixinMembersFromObject(arg),
            loc: locOf(p.node),
          })
        } else if (t.isCallExpression(arg) && t.isIdentifier(arg.callee)) {
          pushApp({
            scope: 'global',
            localName: arg.callee.name,
            factory: true,
            loc: locOf(p.node),
          })
        }
      }
    },

    ObjectProperty(p) {
      if (!t.isIdentifier(p.node.key, { name: 'mixins' }) && !(t.isStringLiteral(p.node.key) && p.node.key.value === 'mixins')) {
        return
      }
      // Only care about mixins in component options (ignore unrelated objects)
      const val = p.node.value
      if (!t.isArrayExpression(val)) return
      val.elements.forEach((el) => {
        if (!el) return
        if (t.isIdentifier(el)) {
          pushApp({
            scope: 'local',
            localName: el.name,
            loc: locOf(el),
          })
        } else if (t.isObjectExpression(el)) {
          pushApp({
            scope: 'local',
            localName: null,
            inline: true,
            members: extractMixinMembersFromObject(el),
            loc: locOf(el),
          })
        } else if (t.isCallExpression(el)) {
          const calleeName = t.isIdentifier(el.callee)
            ? el.callee.name
            : t.isMemberExpression(el.callee) && t.isIdentifier(el.callee.property)
              ? el.callee.property.name
              : null
          pushApp({
            scope: 'local',
            localName: calleeName,
            factory: true,
            loc: locOf(el),
          })
        }
      })
    },
  })

  return apps
}

/**
 * Extract exported members from a parsed mixin module AST (default export object / factory return)
 */
function extractMixinModuleMembers(ast) {
  const result = { members: [], kind: null }
  if (!ast) return result

  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration
      if (t.isObjectExpression(d)) {
        result.kind = 'object'
        result.members = extractMixinMembersFromObject(d)
        p.stop()
      } else if (t.isIdentifier(d)) {
        // export default foo — follow via bindings
        const binding = p.scope.getBinding(d.name)
        if (binding && binding.path) {
          if (binding.path.isVariableDeclarator() && t.isObjectExpression(binding.path.node.init)) {
            result.kind = 'object'
            result.members = extractMixinMembersFromObject(binding.path.node.init)
          } else if (binding.path.isFunctionDeclaration()) {
            result.kind = 'factory'
            result.members = extractReturnObjectMembers(binding.path.node)
          } else if (
            binding.path.isVariableDeclarator() &&
            (t.isFunctionExpression(binding.path.node.init) ||
              t.isArrowFunctionExpression(binding.path.node.init))
          ) {
            result.kind = 'factory'
            result.members = extractReturnObjectMembers(binding.path.node.init)
          }
        }
        p.stop()
      } else if (t.isFunctionDeclaration(d) || t.isFunctionExpression(d) || t.isArrowFunctionExpression(d)) {
        result.kind = 'factory'
        result.members = extractReturnObjectMembers(d)
        p.stop()
      }
    },
  })

  return result
}

function extractReturnObjectMembers(fnNode) {
  const members = []
  if (!fnNode) return members
  const body = fnNode.body
  if (t.isObjectExpression(body)) {
    return extractMixinMembersFromObject(body)
  }
  if (!body || !body.body) return members
  body.body.forEach((stmt) => {
    if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
      members.push(...extractMixinMembersFromObject(stmt.argument))
    }
  })
  return members
}

/**
 * Same-file const foo = { methods... } / function foo(){ return {...} }
 */
function extractLocalBindingMixin(ast, localName) {
  if (!ast || !localName) return null
  let found = null
  traverse(ast, {
    VariableDeclarator(p) {
      if (!t.isIdentifier(p.node.id, { name: localName })) return
      const init = p.node.init
      if (t.isObjectExpression(init)) {
        found = { kind: 'object', members: extractMixinMembersFromObject(init) }
        p.stop()
      } else if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
        found = { kind: 'factory', members: extractReturnObjectMembers(init) }
        p.stop()
      }
    },
    FunctionDeclaration(p) {
      if (p.node.id && p.node.id.name === localName) {
        found = { kind: 'factory', members: extractReturnObjectMembers(p.node) }
        p.stop()
      }
    },
  })
  return found
}

/**
 * Summarize: applications + members per mixin file + member reverse index
 */
function buildMixinIndex(applications, filesMap) {
  const mixinFiles = new Map() // path -> { path, kind, members, appliedBy[] }

  function ensureMixinFile(rel, hint) {
    if (!rel) return null
    if (!mixinFiles.has(rel)) {
      const fileNode = filesMap.get(rel)
      let extracted = { members: [], kind: null }
      if (fileNode && fileNode._asts) {
        // Use first script AST
        const ast = fileNode._asts[0]
        extracted = extractMixinModuleMembers(ast)
      }
      mixinFiles.set(rel, {
        path: rel,
        kind: extracted.kind || hint || 'unknown',
        members: extracted.members || [],
        appliedBy: [],
      })
    }
    return mixinFiles.get(rel)
  }

  applications.forEach((app) => {
    // Import file not resolved: try same-file local binding
    if (!app.mixinFile && app.localName && !app.inline) {
      const host = filesMap.get(app.file)
      if (host && host._asts) {
        for (let i = 0; i < host._asts.length; i += 1) {
          const local = extractLocalBindingMixin(host._asts[i], app.localName)
          if (local) {
            const pseudo = app.file + '#local:' + app.localName
            app.mixinFile = pseudo
            app.sameFile = true
            if (!mixinFiles.has(pseudo)) {
              mixinFiles.set(pseudo, {
                path: pseudo,
                kind: local.kind || 'local-binding',
                members: local.members || [],
                appliedBy: [],
              })
            }
            break
          }
        }
      }
    }

    if (app.mixinFile) {
      const mf = ensureMixinFile(app.mixinFile, app.factory ? 'factory' : 'object')
      if (mf) {
        mf.appliedBy.push({
          file: app.file,
          scope: app.scope,
          localName: app.localName,
          factory: !!app.factory,
          loc: app.loc,
        })
      }
    } else if (app.inline && app.members) {
      // Inline mixin: use host#inline#line as pseudo path
      const pseudo = app.file + '#inline:' + (app.loc && app.loc.line)
      mixinFiles.set(pseudo, {
        path: pseudo,
        kind: 'inline',
        members: app.members,
        appliedBy: [
          {
            file: app.file,
            scope: app.scope,
            localName: null,
            factory: false,
            loc: app.loc,
          },
        ],
      })
      app.mixinFile = pseudo
    }
  })

  // Member to source reverse lookup
  const memberIndex = []
  mixinFiles.forEach((mf) => {
    mf.members.forEach((m) => {
      memberIndex.push({
        name: m.name,
        section: m.section,
        mixinFile: mf.path,
        mixinKind: mf.kind,
        loc: m.loc,
        appliedBy: mf.appliedBy,
        global: mf.appliedBy.some((a) => a.scope === 'global'),
      })
    })
  })

  memberIndex.sort((a, b) => a.name.localeCompare(b.name) || a.mixinFile.localeCompare(b.mixinFile))

  return {
    applications,
    mixins: Array.from(mixinFiles.values()),
    memberIndex,
  }
}

/**
 * Quick lookup: find global mutation sites / mixin-injected members by name
 */
function lookupSymbol(graph, name) {
  const q = String(name || '').replace(/^this\./, '').replace(/^Vue\.prototype\./, '')
  if (!q) return { query: name, globals: [], mixinMembers: [], scopes: [] }

  const globals = (graph.globalIndex || []).filter(
    (g) => g.name === q || g.api === q || g.api.endsWith('.' + q) || g.name.endsWith(q)
  )

  const mixinMembers = ((graph.mixins && graph.mixins.memberIndex) || []).filter(
    (m) => m.name === q || m.name === '$' + q
  )

  // Same-name binding at file top (declaration site, not a global mutation)
  const scopes = []
  ;(graph.files || []).forEach((f) => {
    ;(f.scopeFlat || []).forEach((b) => {
      if (b.name === q && (b.layer === 'file-top-decl' || b.layer === 'file-top-import')) {
        scopes.push({
          file: f.path,
          layer: b.layer,
          kind: b.kind,
          loc: b.loc,
          shadowed: b.shadowed,
        })
      }
    })
  })

  return { query: q, globals, mixinMembers, scopes }
}

module.exports = {
  analyzeMixinApplications,
  extractMixinModuleMembers,
  extractMixinMembersFromObject,
  buildMixinIndex,
  lookupSymbol,
}

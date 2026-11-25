/**
 * Vue Router 3 → 4 (deterministic subset).
 *
 * Router module (plain .js/.ts):
 * - import VueRouter from 'vue-router' → named createRouter / createWeb*History imports
 * - Vue.use(VueRouter) removed; unused `import Vue from 'vue'` dropped
 * - new VueRouter({ mode, base, fallback, … }) → createRouter({ history: createWeb*History(base), … })
 * - path: '*' → '/:pathMatch(.*)*' (relative ':pathMatch(.*)*' inside literal children arrays);
 *   '/foo/*' → '/foo/:pathMatch(.*)*'
 * - scrollBehavior return objects { x, y, selector } → { left, top, el }
 * - router.addRoutes(list) → list.forEach((r) => router.addRoute(r))
 * - router.onReady(ok, err) → router.isReady().then(ok, err)
 * - VueRouter.prototype.push/replace duplicate-navigation patches removed (v4 resolves failures)
 * - VueRouter.isNavigationFailure / NavigationFailureType → named imports
 * - <router>.currentRoute.x → <router>.currentRoute.value.x (v4 currentRoute is a Ref)
 *
 * <script setup> blocks:
 * - this.$route / this.$router → route / router from useRoute() / useRouter()
 *
 * Out of scope (AI-TODO): router.match / getMatchedComponents, non-literal router options.
 * Options API components keep this.$route / this.$router (still valid in Vue3).
 */
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

const HISTORY_BY_MODE = {
  history: 'createWebHistory',
  hash: 'createWebHashHistory',
  abstract: 'createMemoryHistory',
}

const STATIC_ROUTER_MEMBERS = new Set(['isNavigationFailure', 'NavigationFailureType'])

function parse(code, filename) {
  return parser.parse(String(code || ''), {
    sourceType: 'module',
    plugins: BABEL_PLUGINS,
    errorRecovery: true,
    sourceFilename: filename || 'router.js',
  })
}

function gen(ast, code) {
  return generate(ast, { retainLines: false, compact: false, comments: true }, code).code
}

function keyName(prop) {
  if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return null
  if (prop.computed) return null
  if (t.isIdentifier(prop.key)) return prop.key.name
  if (t.isStringLiteral(prop.key)) return prop.key.value
  return null
}

function findImport(ast, source) {
  return ast.program.body.find((n) => t.isImportDeclaration(n) && n.source.value === source) || null
}

function ensureNamedImports(ast, source, names) {
  if (!names.length) return
  let decl = findImport(ast, source)
  if (!decl) {
    decl = t.importDeclaration([], t.stringLiteral(source))
    const lastImport = [...ast.program.body].reverse().find((n) => t.isImportDeclaration(n))
    const idx = lastImport ? ast.program.body.indexOf(lastImport) + 1 : 0
    ast.program.body.splice(idx, 0, decl)
  }
  names.forEach((name) => {
    const has = decl.specifiers.some(
      (s) => t.isImportSpecifier(s) && (s.imported.name || s.imported.value) === name
    )
    if (!has) decl.specifiers.push(t.importSpecifier(t.identifier(name), t.identifier(name)))
  })
}

function isPrototypeMember(node, ctorName) {
  // VueRouter.prototype.<x>
  return (
    t.isMemberExpression(node) &&
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: ctorName }) &&
    t.isIdentifier(node.object.property, { name: 'prototype' })
  )
}

function historyCall(fnName, baseExpr) {
  return t.callExpression(t.identifier(fnName), baseExpr ? [t.cloneNode(baseExpr, true)] : [])
}

/** mode expr (non-literal) → mode === 'history' ? … : mode === 'abstract' ? … : hash */
function historyFromDynamicMode(modeExpr, baseExpr, needed) {
  needed.add('createWebHistory')
  needed.add('createMemoryHistory')
  needed.add('createWebHashHistory')
  const eq = (v) => t.binaryExpression('===', t.cloneNode(modeExpr, true), t.stringLiteral(v))
  return t.conditionalExpression(
    eq('history'),
    historyCall('createWebHistory', baseExpr),
    t.conditionalExpression(
      eq('abstract'),
      historyCall('createMemoryHistory', baseExpr),
      historyCall('createWebHashHistory', baseExpr)
    )
  )
}

const SCROLL_KEYS = new Set(['x', 'y', 'selector', 'offset', 'behavior'])
const SCROLL_RENAME = { x: 'left', y: 'top', selector: 'el' }

function rewriteScrollBehavior(fnNode, changes) {
  traverse(t.file(t.program([t.expressionStatement(fnNode)])), {
    ObjectExpression(p) {
      const keys = p.node.properties.map(keyName)
      if (!keys.length || keys.some((k) => !k || !SCROLL_KEYS.has(k))) return
      if (!keys.some((k) => k in SCROLL_RENAME)) return
      p.node.properties.forEach((prop) => {
        const k = keyName(prop)
        if (SCROLL_RENAME[k]) {
          prop.key = t.identifier(SCROLL_RENAME[k])
          if (prop.shorthand) prop.shorthand = false
        }
      })
      changes.push({ kind: 'router-scroll-position', note: '{ x, y, selector } → { left, top, el }' })
    },
  })
}

function convertRouterOptions(optsNode, needed, changes) {
  if (!t.isObjectExpression(optsNode)) {
    changes.push({ kind: 'router-options-ai', note: 'non-literal router options — map mode/base to history manually' })
    return { node: optsNode, ai: true }
  }
  let modeExpr = null
  let baseExpr = null
  const kept = []
  let hasHistory = false
  optsNode.properties.forEach((prop) => {
    const k = keyName(prop)
    if (k === 'mode' && t.isObjectProperty(prop)) {
      modeExpr = prop.value
      return
    }
    if (k === 'base' && t.isObjectProperty(prop)) {
      baseExpr = prop.value
      return
    }
    if (k === 'fallback') {
      changes.push({ kind: 'router-fallback-dropped' })
      return
    }
    if (k === 'history') hasHistory = true
    if (k === 'scrollBehavior') {
      const fn = t.isObjectMethod(prop) ? prop : prop.value
      if (fn) rewriteScrollBehavior(t.isObjectMethod(prop) ? t.functionExpression(null, prop.params, prop.body) : fn, changes)
    }
    kept.push(prop)
  })

  if (!hasHistory) {
    let historyExpr
    if (!modeExpr) {
      // Vue Router 3 default mode is hash
      needed.add('createWebHashHistory')
      historyExpr = historyCall('createWebHashHistory', baseExpr)
    } else if (t.isStringLiteral(modeExpr) && HISTORY_BY_MODE[modeExpr.value]) {
      needed.add(HISTORY_BY_MODE[modeExpr.value])
      historyExpr = historyCall(HISTORY_BY_MODE[modeExpr.value], baseExpr)
    } else {
      historyExpr = historyFromDynamicMode(modeExpr, baseExpr, needed)
    }
    kept.unshift(t.objectProperty(t.identifier('history'), historyExpr))
    changes.push({
      kind: 'router-history',
      mode: modeExpr && t.isStringLiteral(modeExpr) ? modeExpr.value : modeExpr ? 'dynamic' : 'hash(default)',
    })
  }
  return { node: t.objectExpression(kept), ai: false }
}

function isInsideLiteralChildren(objPath) {
  const arr = objPath.parentPath
  if (!arr || !arr.isArrayExpression()) return false
  const prop = arr.parentPath
  return !!(prop && prop.isObjectProperty() && keyName(prop.node) === 'children')
}

/**
 * Router module rewrite (plain JS).
 * @returns {{ code: string, changes: object[] }}
 */
function migrateRouterModule(code, filename) {
  const changes = []
  let ast
  try {
    ast = parse(code, filename)
  } catch (e) {
    return { code, changes, error: String(e && e.message) }
  }

  const routerImport = findImport(ast, 'vue-router')
  const defaultSpec = routerImport && routerImport.specifiers.find((s) => t.isImportDefaultSpecifier(s))
  const ctorName = defaultSpec ? defaultSpec.local.name : null
  const needed = new Set()
  const routerBindings = new Set()
  const aiNotes = []

  // Pass 1: collect duplicate-navigation prototype patches
  const patchStmts = new Set()
  const patchDecls = []
  if (ctorName) {
    traverse(ast, {
      AssignmentExpression(p) {
        if (!isPrototypeMember(p.node.left, ctorName)) return
        const stmt = p.parentPath
        if (stmt && stmt.isExpressionStatement()) patchStmts.add(stmt)
      },
      VariableDeclarator(p) {
        if (isPrototypeMember(p.node.init, ctorName) && t.isIdentifier(p.node.id)) patchDecls.push(p)
      },
    })
  }

  traverse(ast, {
    CallExpression(p) {
      const { callee } = p.node
      // Vue.use(VueRouter)
      if (
        ctorName &&
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property, { name: 'use' }) &&
        p.node.arguments.length >= 1 &&
        t.isIdentifier(p.node.arguments[0], { name: ctorName }) &&
        p.parentPath.isExpressionStatement()
      ) {
        p.parentPath.remove()
        changes.push({ kind: 'router-vue-use-removed', note: 'Vue.use(VueRouter) → app.use(router) in entry' })
        return
      }
      if (!t.isMemberExpression(callee) || callee.computed || !t.isIdentifier(callee.property)) return
      const method = callee.property.name
      const objOk = t.isIdentifier(callee.object) || t.isMemberExpression(callee.object)
      if (method === 'addRoutes' && p.node.arguments.length === 1 && objOk) {
        const r = t.identifier('__v23Route')
        p.replaceWith(
          t.callExpression(t.memberExpression(p.node.arguments[0], t.identifier('forEach')), [
            t.arrowFunctionExpression(
              [r],
              t.callExpression(t.memberExpression(t.cloneNode(callee.object, true), t.identifier('addRoute')), [r])
            ),
          ])
        )
        changes.push({ kind: 'router-addRoutes', note: 'addRoutes(list) → list.forEach(addRoute)' })
        return
      }
      if (method === 'onReady' && p.node.arguments.length >= 1 && p.node.arguments.length <= 2) {
        p.replaceWith(
          t.callExpression(
            t.memberExpression(
              t.callExpression(t.memberExpression(callee.object, t.identifier('isReady')), []),
              t.identifier('then')
            ),
            p.node.arguments
          )
        )
        changes.push({ kind: 'router-onReady', note: 'onReady(cb) → isReady().then(cb)' })
        return
      }
      if (method === 'getMatchedComponents' || (method === 'match' && routerBindings.has(calleeRootName(callee)))) {
        aiNotes.push('router.' + method + ' removed in Vue Router 4 — use router.resolve / route.matched')
      }
    },
    NewExpression(p) {
      if (!ctorName || !t.isIdentifier(p.node.callee, { name: ctorName })) return
      needed.add('createRouter')
      const opts = p.node.arguments[0] || t.objectExpression([])
      const conv = convertRouterOptions(opts, needed, changes)
      if (conv.ai) aiNotes.push('new VueRouter(options) with non-literal options — map mode/base → history manually')
      p.replaceWith(t.callExpression(t.identifier('createRouter'), [conv.node]))
      const decl = p.parentPath
      if (decl && decl.isVariableDeclarator() && t.isIdentifier(decl.node.id)) routerBindings.add(decl.node.id.name)
      changes.push({ kind: 'router-createRouter' })
    },
    ObjectProperty(p) {
      if (keyName(p.node) !== 'path' || !t.isStringLiteral(p.node.value)) return
      const v = p.node.value.value
      let next = null
      if (v === '*') next = isInsideLiteralChildren(p.parentPath) ? ':pathMatch(.*)*' : '/:pathMatch(.*)*'
      else if (/\/\*$/.test(v)) next = v.slice(0, -1) + ':pathMatch(.*)*'
      if (next) {
        p.node.value = t.stringLiteral(next)
        changes.push({ kind: 'router-catch-all', from: v, to: next })
      }
    },
    MemberExpression(p) {
      if (!ctorName) return
      if (t.isIdentifier(p.node.object, { name: ctorName }) && t.isIdentifier(p.node.property) && !p.node.computed) {
        const name = p.node.property.name
        if (STATIC_ROUTER_MEMBERS.has(name)) {
          needed.add(name)
          p.replaceWith(t.identifier(name))
          changes.push({ kind: 'router-static-member', name })
        }
      }
    },
  })

  // Remove prototype patches whose helper decls are only used by the patches
  if (patchStmts.size) {
    const patchNodes = new Set([...patchStmts].map((s) => s.node))
    patchDecls.forEach((dp) => {
      const binding = dp.scope.getBinding(dp.node.id.name)
      const onlyInPatch =
        binding &&
        binding.referencePaths.every((rp) => rp.findParent((pp) => patchNodes.has(pp.node)))
      if (onlyInPatch) {
        const declStmt = dp.parentPath
        if (declStmt.node.declarations.length === 1) declStmt.remove()
        else dp.remove()
      }
    })
    patchStmts.forEach((s) => s.remove())
    changes.push({
      kind: 'router-prototype-patch-removed',
      note: 'VueRouter.prototype.push/replace patch — v4 resolves navigation failures instead of rejecting',
    })
  }

  // currentRoute is a Ref in v4
  if (routerBindings.size) {
    traverse(ast, {
      MemberExpression(p) {
        if (!t.isIdentifier(p.node.property, { name: 'currentRoute' }) || p.node.computed) return
        if (!t.isIdentifier(p.node.object) || !routerBindings.has(p.node.object.name)) return
        const parent = p.parentPath
        if (parent.isMemberExpression() && t.isIdentifier(parent.node.property, { name: 'value' })) return
        if (parent.isAssignmentExpression() && parent.node.left === p.node) return
        p.replaceWith(t.memberExpression(p.node, t.identifier('value')))
        p.skip()
        changes.push({ kind: 'router-currentRoute-ref' })
      },
    })
  }

  if (!changes.length && !aiNotes.length) return { code, changes }

  // Imports
  if (routerImport && defaultSpec) {
    traverse(ast, { Program(p) { p.scope.crawl() } })
    let stillUsed = false
    traverse(ast, {
      Program(p) {
        const b = p.scope.getBinding(ctorName)
        stillUsed = !!(b && b.referencePaths.length)
      },
    })
    if (!stillUsed) {
      routerImport.specifiers = routerImport.specifiers.filter((s) => s !== defaultSpec)
    } else {
      aiNotes.push(ctorName + ' is still referenced — Vue Router 4 has no default class export')
    }
  }
  ensureNamedImports(ast, 'vue-router', [...needed])
  dropUnusedVueDefault(ast, changes)

  let out = gen(ast, code)
  if (aiNotes.length) {
    out =
      [...new Set(aiNotes)].map((n) => '/* AI-TODO: [router] ' + n + ' */').join('\n') + '\n' + out
  }
  return { code: out, changes, aiNotes }
}

function calleeRootName(callee) {
  let o = callee.object
  while (t.isMemberExpression(o)) o = o.object
  return t.isIdentifier(o) ? o.name : null
}

function dropUnusedVueDefault(ast, changes) {
  const vueImport = findImport(ast, 'vue')
  if (!vueImport) return
  const def = vueImport.specifiers.find((s) => t.isImportDefaultSpecifier(s))
  if (!def) return
  let used = true
  traverse(ast, {
    Program(p) {
      p.scope.crawl()
      const b = p.scope.getBinding(def.local.name)
      used = !!(b && b.referencePaths.length)
    },
  })
  if (used) return
  vueImport.specifiers = vueImport.specifiers.filter((s) => s !== def)
  if (!vueImport.specifiers.length) {
    ast.program.body.splice(ast.program.body.indexOf(vueImport), 1)
  }
  changes.push({ kind: 'router-vue-default-dropped', note: 'unused `import Vue` after Vue.use removal' })
}

function uniqueId(ast, base) {
  let name = base
  let i = 1
  let taken = true
  while (taken) {
    taken = false
    traverse(ast, {
      Program(p) {
        p.scope.crawl()
        taken = p.scope.hasBinding(name)
      },
    })
    if (taken) name = base + '_' + i++
  }
  return name
}

/**
 * <script setup> block: this.$route / this.$router → useRoute() / useRouter().
 * @returns {{ code: string, changes: object[] }}
 */
function migrateRouterScriptSetup(code, filename) {
  const changes = []
  if (!/this\.\$route/.test(code)) return { code, changes }
  let ast
  try {
    ast = parse(code, filename)
  } catch (e) {
    return { code, changes, error: String(e && e.message) }
  }

  const used = { $route: false, $router: false }
  traverse(ast, {
    MemberExpression(p) {
      if (!t.isThisExpression(p.node.object) || p.node.computed) return
      if (t.isIdentifier(p.node.property, { name: '$route' })) used.$route = true
      if (t.isIdentifier(p.node.property, { name: '$router' })) used.$router = true
    },
  })
  if (!used.$route && !used.$router) return { code, changes }

  const ids = {}
  if (used.$route) ids.$route = uniqueId(ast, 'route')
  if (used.$router) ids.$router = uniqueId(ast, 'router')

  traverse(ast, {
    MemberExpression(p) {
      if (!t.isThisExpression(p.node.object) || p.node.computed || !t.isIdentifier(p.node.property)) return
      const key = p.node.property.name
      if (!ids[key]) return
      p.replaceWith(t.identifier(ids[key]))
    },
  })

  // this.$router.currentRoute → router.currentRoute.value
  if (ids.$router) {
    traverse(ast, {
      MemberExpression(p) {
        if (!t.isIdentifier(p.node.property, { name: 'currentRoute' }) || p.node.computed) return
        if (!t.isIdentifier(p.node.object, { name: ids.$router })) return
        const parent = p.parentPath
        if (parent.isMemberExpression() && t.isIdentifier(parent.node.property, { name: 'value' })) return
        p.replaceWith(t.memberExpression(p.node, t.identifier('value')))
        p.skip()
      },
    })
  }

  const decls = []
  const imports = []
  if (ids.$route) {
    imports.push('useRoute')
    decls.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(ids.$route), t.callExpression(t.identifier('useRoute'), []))]))
    changes.push({ kind: 'router-useRoute', id: ids.$route })
  }
  if (ids.$router) {
    imports.push('useRouter')
    decls.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(ids.$router), t.callExpression(t.identifier('useRouter'), []))]))
    changes.push({ kind: 'router-useRouter', id: ids.$router })
  }
  ensureNamedImports(ast, 'vue-router', imports)
  const body = ast.program.body
  const lastImport = [...body].reverse().find((n) => t.isImportDeclaration(n))
  const at = lastImport ? body.indexOf(lastImport) + 1 : 0
  body.splice(at, 0, ...decls)

  return { code: gen(ast, code), changes }
}

/** Route record `component: () => import()` must stay a plain lazy loader in Vue Router 4. */
function isRouteRecordComponent(path) {
  const prop = path.parentPath
  if (!prop || !prop.isObjectProperty() || prop.node.value !== path.node) return false
  const key = keyName(prop.node)
  const obj = prop.parentPath
  if (key === 'component' && obj && obj.isObjectExpression()) {
    return obj.node.properties.some((p) => keyName(p) === 'path')
  }
  // named views: components: { default: () => import() }
  const compsProp = obj && obj.parentPath
  if (compsProp && compsProp.isObjectProperty() && keyName(compsProp.node) === 'components') {
    const record = compsProp.parentPath
    return !!(record && record.isObjectExpression() && record.node.properties.some((p) => keyName(p) === 'path'))
  }
  return false
}

module.exports = {
  migrateRouterModule,
  migrateRouterScriptSetup,
  isRouteRecordComponent,
}

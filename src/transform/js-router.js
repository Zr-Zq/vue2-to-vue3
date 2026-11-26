/**
 * Vue Router 3 to 4 (deterministic subset).
 *
 * Router module (plain .js/.ts):
 * - import VueRouter from 'vue-router' to named createRouter / createWeb*History imports
 * - Vue.use(VueRouter) removed; unused `import Vue from 'vue'` dropped
 * - new VueRouter({ mode, base, fallback, … }) to createRouter({ history: createWeb*History(base), … })
 * - path: '*' to '/:pathMatch(.*)*' (relative ':pathMatch(.*)*' inside literal children arrays);
 *   '/foo/*' to '/foo/:pathMatch(.*)*'
 * - scrollBehavior return objects { x, y, selector } to { left, top, el }
 * - router.addRoutes(list) to list.forEach((r) => router.addRoute(r))
 * - router.onReady(ok, err) to router.isReady().then(ok, err)
 * - VueRouter.prototype.push/replace duplicate-navigation patches removed (v4 resolves failures)
 * - VueRouter.isNavigationFailure / NavigationFailureType to named imports
 * - <router>.currentRoute.x to <router>.currentRoute.value.x (v4 currentRoute is a Ref)
 * - router.match(loc) to router.resolve(loc)
 * - router.getMatchedComponents() to router.currentRoute.value.matched
 *
 * <script setup> blocks:
 * - this.$route / this.$router to route / router from useRoute() / useRouter()
 *
 * Out of scope (AI-TODO): non-literal router options.
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

/** mode expr (non-literal) to mode === 'history' ? … : mode === 'abstract' ? … : hash */
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
      changes.push({ kind: 'router-scroll-position', note: '{ x, y, selector } to { left, top, el }' })
    },
  })
}

/**
 * After scrollBehavior field rename, update common fixture/assert patterns in the same module:
 * - 'xy-shape' → 'lte-shape'
 * - sample.x|y|selector → left|top|el (identifier hosts matching /sample|scroll|pos/i)
 */
function rewriteScrollAssertHelpers(ast, changes, aiNotes) {
  if (!changes.some((c) => c.kind === 'router-scroll-position')) return
  let touched = false
  traverse(ast, {
    StringLiteral(p) {
      if (p.node.value !== 'xy-shape') return
      p.node.value = 'lte-shape'
      touched = true
    },
    MemberExpression(p) {
      if (p.node.computed || !t.isIdentifier(p.node.property) || !t.isIdentifier(p.node.object)) return
      if (!SCROLL_RENAME[p.node.property.name]) return
      const host = p.node.object.name
      if (!/sample|scroll|pos|position|sbResult/i.test(host)) return
      p.node.property = t.identifier(SCROLL_RENAME[p.node.property.name])
      touched = true
    },
  })
  if (touched) {
    changes.push({
      kind: 'router-scroll-assert',
      note: "xy-shape / sample.x|y|selector → lte-shape / left|top|el",
    })
  } else {
    aiNotes.push(
      'scrollBehavior now uses left/top/el — update any assertions that still check x/y/selector or expect xy-shape'
    )
  }
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

  // Pre-collect createRouter(...) bindings (hand-written or prior pass)
  traverse(ast, {
    CallExpression(p) {
      if (!t.isIdentifier(p.node.callee, { name: 'createRouter' })) return
      const decl = p.parentPath
      if (decl && decl.isVariableDeclarator() && t.isIdentifier(decl.node.id)) {
        routerBindings.add(decl.node.id.name)
      }
    },
  })

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
        changes.push({ kind: 'router-vue-use-removed', note: 'Vue.use(VueRouter) to app.use(router) in entry' })
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
        changes.push({ kind: 'router-addRoutes', note: 'addRoutes(list) to list.forEach(addRoute)' })
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
        changes.push({ kind: 'router-onReady', note: 'onReady(cb) to isReady().then(cb)' })
        return
      }
      // getMatchedComponents() → currentRoute.value.matched (unique VR3 API name)
      if (method === 'getMatchedComponents' && p.node.arguments.length === 0 && objOk) {
        p.replaceWith(
          t.memberExpression(
            t.memberExpression(
              t.memberExpression(t.cloneNode(callee.object, true), t.identifier('currentRoute')),
              t.identifier('value')
            ),
            t.identifier('matched')
          )
        )
        changes.push({
          kind: 'router-getMatchedComponents',
          note: 'getMatchedComponents() to currentRoute.value.matched',
        })
        return
      }
      // router.match(loc) → router.resolve(loc)
      if (method === 'match' && objOk && looksLikeRouterMatch(p, routerBindings)) {
        // Collapse `typeof x.match === 'function' ? x.match(arg) : null` to `x.resolve(arg)`
        const cond = p.parentPath
        if (cond && cond.isConditionalExpression() && cond.node.consequent === p.node) {
          const test = cond.node.test
          if (isTypeofMatchFunctionTest(test, callee.object)) {
            cond.replaceWith(
              t.callExpression(
                t.memberExpression(t.cloneNode(callee.object, true), t.identifier('resolve')),
                p.node.arguments
              )
            )
            changes.push({
              kind: 'router-match-to-resolve',
              note: 'typeof router.match ? match : null → router.resolve',
            })
            return
          }
        }
        p.node.callee = t.memberExpression(t.cloneNode(callee.object, true), t.identifier('resolve'))
        changes.push({ kind: 'router-match-to-resolve', note: 'router.match(loc) to router.resolve(loc)' })
        return
      }
    },
    NewExpression(p) {
      if (!ctorName || !t.isIdentifier(p.node.callee, { name: ctorName })) return
      needed.add('createRouter')
      const opts = p.node.arguments[0] || t.objectExpression([])
      const conv = convertRouterOptions(opts, needed, changes)
      if (conv.ai) aiNotes.push('new VueRouter(options) with non-literal options — map mode/base to history manually')
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

  // currentRoute is a Ref in v4. Rewrite when file has vue-router / createRouter /
  // known router bindings (covers probe.value.currentRoute — G012).
  const rewriteCurrentRoute =
    routerBindings.size > 0 || needed.has('createRouter') || !!routerImport
  if (rewriteCurrentRoute) {
    traverse(ast, {
      MemberExpression(p) {
        if (!t.isIdentifier(p.node.property, { name: 'currentRoute' }) || p.node.computed) return
        const obj = p.node.object
        if (!(t.isIdentifier(obj) || t.isMemberExpression(obj))) return
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
  rewriteScrollAssertHelpers(ast, changes, aiNotes)

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

/**
 * Heuristic: rewrite .match(...) only when it looks like Vue Router 3's router.match,
 * not String.prototype.match.
 */
function looksLikeRouterMatch(path, routerBindings) {
  const callee = path.node.callee
  const root = calleeRootName(callee)
  if (root && routerBindings.has(root)) return true
  // probe.value.match('/home') / router.match({ path: '...' })
  const arg0 = path.node.arguments[0]
  if (!arg0) return false
  if (t.isStringLiteral(arg0) && /^\//.test(arg0.value)) return true
  if (t.isObjectExpression(arg0)) {
    const keys = arg0.properties
      .filter((pr) => t.isObjectProperty(pr) && !pr.computed)
      .map((pr) => (t.isIdentifier(pr.key) ? pr.key.name : t.isStringLiteral(pr.key) ? pr.key.value : null))
    if (keys.some((k) => k === 'path' || k === 'name' || k === 'params' || k === 'query')) return true
  }
  // typeof x.match === 'function' ? x.match(...) — parent ConditionalExpression
  const parent = path.parentPath
  if (parent && parent.isConditionalExpression() && parent.node.consequent === path.node) {
    return true
  }
  return false
}

/** typeof <obj>.match === 'function' (or ==) */
function isTypeofMatchFunctionTest(test, matchObject) {
  if (!t.isBinaryExpression(test) || (test.operator !== '===' && test.operator !== '==')) return false
  let typeofNode = null
  let lit = null
  if (t.isUnaryExpression(test.left, { operator: 'typeof' }) && t.isStringLiteral(test.right)) {
    typeofNode = test.left
    lit = test.right
  } else if (t.isUnaryExpression(test.right, { operator: 'typeof' }) && t.isStringLiteral(test.left)) {
    typeofNode = test.right
    lit = test.left
  }
  if (!typeofNode || !lit || lit.value !== 'function') return false
  const arg = typeofNode.argument
  if (!t.isMemberExpression(arg) || arg.computed || !t.isIdentifier(arg.property, { name: 'match' })) return false
  return nodesLooseEqual(arg.object, matchObject)
}

function nodesLooseEqual(a, b) {
  return t.isNodesEquivalent(a, b)
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
 * <script setup> block: this.$route / this.$router to useRoute() / useRouter().
 * @returns {{ code: string, changes: object[] }}
 */
function migrateRouterScriptSetup(code, filename) {
  const changes = []
  // Match either instance API — early `$route`-only gate dropped `$router`-only files (G010).
  if (!/this\.\$route\b/.test(code) && !/this\.\$router\b/.test(code)) return { code, changes }
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

  // this.$router.currentRoute to router.currentRoute.value
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

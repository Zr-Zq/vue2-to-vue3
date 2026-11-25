/**
 * Options API to Composition (setup) — deterministic safe path.
 *
 * - Flatten local object mixins (final winning members); same-file identifiers resolved
 *   including nested mixins:[mid] where mid.mixins:[deep] (imports still AI)
 * - data to ref; computed to computed() / { get, set }; methods to functions
 * - watch to watch(); provide to provide(); inject to inject()
 * - provide primitives to ref() + AI-TODO for inject side (partial)
 * - filters remnant to methods (migrate-filters usually already did this; on name
 *   collision keep method and store filter as __v23Filter_<name>)
 * - Output target: <script setup> (no defineComponent / no setup() return)
 * - defineProps / defineEmits / defineOptions macros
 * - directives to const vName = …; inheritAttrs/name to defineOptions
 * - model to AI-TODO (prop/event rename is product-facing)
 * - this.member to member / member.value; expand `const self = this` then self.foo first
 * - official $ APIs (see OFFICIAL_DOLLAR)
 * - this.$el / bare this.$refs / $parent / $root / $options to __v23Proxy?.…
 *   (setup captures getCurrentInstance()?.proxy so methods do not crash on undefined this)
 * - data() prelude / shorthand / this.prop to IIFE init or props.* rewrite (avoid TDZ)
 * - local components inlined into defineOptions.components (string :is still resolves)
 * - defineExpose(methods + data + computed) for parent $refs access
 * - imported mixins / extends to keep Options API + AI-TODO (no script setup)
 * - $data to v23Data; $props to props
 * - $createElement to h; $vnode / $forceUpdate / $destroy to __v23Proxy bridge (safe in methods);
 *   $ssrContext to setup-captured useSSRContext() (SSR builds only)
 * - this.$options.methods/computed/… to AI-TODO (gone in script setup)
 * - $children left AI (removed in Vue3)
 * - this._xxx in data() to ref like other data (+ AI-TODO); custom fields to __v23Self._xxx;
 *   Vue-internal _uid etc. left
 * - Lifecycle to onXxx; beforeCreate + created to setup-inline (in that order)
 * - bind/call/apply incomingThis recorded; $parent/$children/$root to AI
 * - TS type carry only (never invent): data() return type to ref<T>; PropType / method annos kept
 *
 * Out of scope (handled by dedicated plugins, not this transform):
 * - this.$router / this.$route to router plugin
 * - this.$store / mapState|mapGetters|… to vuex plugin
 * - this.$i18n / this.$t / this.$tc / … to i18n plugin
 * - class / @Component / vue-property-decorator to typescript plugin (AI-TODO)
 * Leave those this.* members untouched here so later plugins can rewrite them.
 */
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { analyzeThisRebinding, analyzeThisUnderscore } = require('./this-rebinding')
const { toDefineAsyncComponent } = require('./js-async-component')

const BABEL_PLUGINS = [
  'jsx',
  'typescript',
  'decorators-legacy',
  'classProperties',
  'optionalChaining',
  'nullishCoalescingOperator',
  'objectRestSpread',
  'dynamicImport',
]

/** $children removed in Vue3 — leave this.$children for AI. $parent/$root bridged via proxy. */
const AI_PARENT = new Set(['$children'])

const OFFICIAL_DOLLAR = {
  $emit: { kind: 'emit' },
  $nextTick: { kind: 'nextTick' },
  $attrs: { kind: 'attrs' },
  $slots: { kind: 'slots' },
  // bare $refs / $el to __v23Proxy bridge; this.$refs.foo still rewritten to ref.value
  $watch: { kind: 'watch' },
  $data: { kind: 'dataBag' },
  $props: { kind: 'propsBag' },
  $createElement: { kind: 'h' },
  $vnode: { kind: 'vnode' },
  $forceUpdate: { kind: 'forceUpdate' },
  $destroy: { kind: 'destroy' },
  $isServer: { kind: 'isServer' },
  $ssrContext: { kind: 'ssrContext' },
  // $options: intentionally left as this.$options (no rewrite)
}

/** Hooks we collect; beforeCreate/created are inlined into setup, the rest map to onXxx. */
const LIFECYCLE_HOOKS = [
  'beforeCreate',
  'created',
  'beforeMount',
  'mounted',
  'beforeUpdate',
  'updated',
  'activated',
  'deactivated',
  'beforeDestroy',
  'destroyed',
  'beforeUnmount',
  'unmounted',
  'errorCaptured',
  'serverPrefetch',
  'renderTracked',
  'renderTriggered',
]

const LIFECYCLE_TO_VUE = {
  beforeMount: 'onBeforeMount',
  mounted: 'onMounted',
  beforeUpdate: 'onBeforeUpdate',
  updated: 'onUpdated',
  activated: 'onActivated',
  deactivated: 'onDeactivated',
  beforeDestroy: 'onBeforeUnmount',
  beforeUnmount: 'onBeforeUnmount',
  destroyed: 'onUnmounted',
  unmounted: 'onUnmounted',
  errorCaptured: 'onErrorCaptured',
  serverPrefetch: 'onServerPrefetch',
  renderTracked: 'onRenderTracked',
  renderTriggered: 'onRenderTriggered',
}

/** getCurrentInstance().proxy.$forceUpdate */
// Instance APIs go through the proxy captured in setup: getCurrentInstance() is null inside
// methods / event handlers, which run after setup returns.
function exprProxyMember(proxyId, key) {
  return t.optionalMemberExpression(t.identifier(proxyId), t.identifier(key), false, true)
}

// Continue an optional chain without adding another `?.` (plain MemberExpression would
// print as `(a?.b).c` and break short-circuiting).
function chainMember(obj, key) {
  return t.optionalMemberExpression(obj, t.identifier(key), false, false)
}

/** __v23Proxy?.$.<key> — internal instance (vnode, appContext) */
function exprInternalInstance(proxyId, key) {
  return chainMember(exprProxyMember(proxyId, '$'), key)
}

function exprForceUpdate(proxyId) {
  return exprProxyMember(proxyId, '$forceUpdate')
}

/** __v23Proxy?.$.appContext.app.unmount — root-oriented; child self-destroy still needs AI/v-if */
function exprDestroyUnmount(proxyId) {
  return chainMember(chainMember(exprInternalInstance(proxyId, 'appContext'), 'app'), 'unmount')
}

function parse(code) {
  return parser.parse(String(code || ''), {
    sourceType: 'module',
    plugins: BABEL_PLUGINS,
    errorRecovery: true,
  })
}

function gen(ast) {
  return generate(ast, { compact: false, retainLines: false, comments: true }, '').code
}

function propKeyName(prop) {
  if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return null
  if (prop.computed) return null
  if (t.isIdentifier(prop.key)) return prop.key.name
  if (t.isStringLiteral(prop.key)) return prop.key.value
  return null
}

function isPrimitiveNode(node) {
  return (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument))
  )
}

function getOptionsObject(ast) {
  let found = null
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration
      if (t.isObjectExpression(d)) found = { node: d, path: p }
      else if (
        t.isCallExpression(d) &&
        t.isIdentifier(d.callee, { name: 'defineComponent' }) &&
        t.isObjectExpression(d.arguments[0])
      ) {
        found = { node: d.arguments[0], path: p }
      }
    },
  })
  return found
}

function optionProp(obj, name) {
  if (!obj || !obj.properties) return null
  for (const p of obj.properties) {
    if (propKeyName(p) === name) return p
  }
  return null
}

function collectLocalObjects(ast) {
  const map = Object.create(null)
  ast.program.body.forEach((stmt) => {
    if (!t.isVariableDeclaration(stmt)) return
    stmt.declarations.forEach((d) => {
      if (t.isIdentifier(d.id) && t.isObjectExpression(d.init)) {
        map[d.id.name] = d.init
      }
    })
  })
  return map
}

function resolveMixinElement(el, localObjects, unresolved) {
  if (t.isObjectExpression(el)) return el
  if (t.isIdentifier(el) && localObjects[el.name]) return localObjects[el.name]
  if (el) unresolved.push(gen(el).slice(0, 48))
  return null
}

function getDataFunctionNode(dataP) {
  if (!dataP) return null
  if (t.isObjectMethod(dataP)) return dataP
  if (t.isObjectProperty(dataP)) {
    if (t.isFunctionExpression(dataP.value) || t.isArrowFunctionExpression(dataP.value)) return dataP.value
  }
  return null
}

function getDataFunctionBody(dataP) {
  const fn = getDataFunctionNode(dataP)
  if (!fn) return null
  if (t.isBlockStatement(fn.body)) return fn.body
  return null
}

function takeDataReturnKeys(dataP, dataKeys) {
  const body = getDataFunctionBody(dataP)
  if (!body) return
  body.body.forEach((stmt) => {
    if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
      stmt.argument.properties.forEach((dp) => {
        const k = propKeyName(dp)
        if (k) dataKeys[k] = dp
      })
    }
  })
}

/** Normalize data option to a FunctionExpression for cloning / IIFE. */
function dataFnAsFunctionExpression(dataP) {
  const fn = getDataFunctionNode(dataP)
  if (!fn) return null
  if (t.isObjectMethod(fn)) {
    return t.functionExpression(null, fn.params, fn.body, fn.generator, fn.async)
  }
  return t.cloneNode(fn, true)
}

/** True when data() has prelude stmts, shorthand returns, or `this` — needs IIFE init. */
function dataFnNeedsIife(dataP) {
  const body = getDataFunctionBody(dataP)
  if (!body) return false
  let returnCount = 0
  let hasPrelude = false
  let hasThis = false
  let hasShorthand = false
  body.body.forEach((stmt) => {
    if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
      returnCount += 1
      stmt.argument.properties.forEach((dp) => {
        if (t.isObjectProperty(dp) && dp.shorthand) hasShorthand = true
      })
    } else {
      hasPrelude = true
    }
  })
  const asFn = dataFnAsFunctionExpression(dataP)
  if (asFn) {
    traverse(t.file(t.program([t.expressionStatement(asFn)])), {
      ThisExpression(path) {
        hasThis = true
        path.stop()
      },
    })
  }
  return hasPrelude || hasShorthand || hasThis || returnCount !== 1
}

/**
 * Rewrite `this` / `this.prop` inside a data() fn to `props` / `props.prop`.
 * data() runs before other instance state — only props are safe to read.
 * @returns {import('@babel/types').FunctionExpression|import('@babel/types').ArrowFunctionExpression|null}
 */
function rewriteDataFnThisToProps(dataP, propNames) {
  const clone = dataFnAsFunctionExpression(dataP)
  if (!clone) return null
  traverse(t.file(t.program([t.expressionStatement(clone)])), {
    MemberExpression(path) {
      if (!t.isThisExpression(path.node.object)) return
      if (path.node.computed || !t.isIdentifier(path.node.property)) return
      const key = path.node.property.name
      if (propNames && propNames.has(key)) {
        path.replaceWith(t.memberExpression(t.identifier('props'), t.identifier(key)))
        path.skip()
      }
    },
    ThisExpression(path) {
      // e.g. const { label: brokenLabel } = this  to  = props
      const parent = path.parentPath
      if (!parent) return
      if (parent.isVariableDeclarator() && parent.node.init === path.node) {
        path.replaceWith(t.identifier('props'))
        return
      }
      if (parent.isAssignmentExpression() && parent.node.right === path.node) {
        path.replaceWith(t.identifier('props'))
      }
    },
  })
  return clone
}

function keysFromDataReturn(dataP) {
  const bag = Object.create(null)
  takeDataReturnKeys(dataP, bag)
  return new Set(Object.keys(bag))
}

/**
 * Rewrite a lone data init expression: this.prop to props.prop.
 */
function rewriteDataInitExpr(expr, propNames) {
  if (!expr) return t.identifier('undefined')
  const clone = t.cloneNode(expr, true)
  traverse(t.file(t.program([t.expressionStatement(clone)])), {
    MemberExpression(path) {
      if (!t.isThisExpression(path.node.object)) return
      if (path.node.computed || !t.isIdentifier(path.node.property)) return
      const key = path.node.property.name
      if (propNames && propNames.has(key)) {
        path.replaceWith(t.memberExpression(t.identifier('props'), t.identifier(key)))
        path.skip()
      }
    },
  })
  return clone
}

/**
 * Expand one mixin object: nested `mixins: […]` first (Vue merge order), then self.
 * Same-file object literals / local const identifiers only; imports stay unresolved (AI).
 * Cycle-safe via `seen` (each object once).
 */
function expandMixinTree(obj, locals, unresolved, chain, seen) {
  if (!obj || seen.has(obj)) return
  seen.add(obj)
  const mix = optionProp(obj, 'mixins')
  if (mix && t.isObjectProperty(mix) && t.isArrayExpression(mix.value)) {
    mix.value.elements.forEach((el) => {
      const child = resolveMixinElement(el, locals, unresolved)
      if (child) expandMixinTree(child, locals, unresolved, chain, seen)
    })
  }
  chain.push(obj)
}

/** Merge mixin objects lefttoright; later wins. Hooks concat. Nested same-file mixins recurse. */
function flattenMixins(hostObj, localObjects) {
  const locals = localObjects || Object.create(null)
  const mix = optionProp(hostObj, 'mixins')
  const chain = []
  const unresolvedMixins = []
  const seen = new WeakSet()

  if (mix && t.isObjectProperty(mix) && t.isArrayExpression(mix.value)) {
    mix.value.elements.forEach((el) => {
      const obj = resolveMixinElement(el, locals, unresolvedMixins)
      if (obj) expandMixinTree(obj, locals, unresolvedMixins, chain, seen)
    })
  }
  // Host options last (wins). Do not re-walk host.mixins — already expanded above.
  chain.push(hostObj)

  const dataKeys = Object.create(null)
  const methodBodies = Object.create(null)
  const computedBodies = Object.create(null)
  const watchBodies = Object.create(null)
  const lifecycle = Object.create(null)
  let propsNode = null
  let componentsNode = null
  let directivesNode = null
  let inheritAttrsNode = null
  let modelNode = null
  let provideNode = null
  let injectNode = null
  let nameVal = null
  let lastDataProp = null
  const filtersMerged = []
  const filterRenames = Object.create(null)

  chain.forEach((obj) => {
    const dataP = optionProp(obj, 'data')
    if (dataP) {
      takeDataReturnKeys(dataP, dataKeys)
      lastDataProp = dataP
    }

    const methodsP = optionProp(obj, 'methods')
    if (methodsP && t.isObjectProperty(methodsP) && t.isObjectExpression(methodsP.value)) {
      methodsP.value.properties.forEach((mp) => {
        const k = propKeyName(mp)
        if (k) methodBodies[k] = mp
      })
    }

    // filters to methods if still present (migrate-filters usually already merged)
    const filtersP = optionProp(obj, 'filters')
    if (filtersP && t.isObjectProperty(filtersP) && t.isObjectExpression(filtersP.value)) {
      const { filterAlias, withPropKey } = require('./js-filters-option')
      filtersP.value.properties.forEach((fp) => {
        const k = propKeyName(fp)
        if (!k) return
        if (!methodBodies[k]) {
          methodBodies[k] = fp
          filtersMerged.push(k)
          return
        }
        let alias = filterAlias(k)
        let n = 2
        while (methodBodies[alias]) {
          alias = filterAlias(k) + '_' + n
          n += 1
        }
        methodBodies[alias] = withPropKey(fp, alias)
        filtersMerged.push(alias)
        filterRenames[k] = alias
      })
    }

    const computedP = optionProp(obj, 'computed')
    if (computedP && t.isObjectProperty(computedP) && t.isObjectExpression(computedP.value)) {
      computedP.value.properties.forEach((cp) => {
        const k = propKeyName(cp)
        if (k) computedBodies[k] = cp
      })
    }

    const watchP = optionProp(obj, 'watch')
    if (watchP && t.isObjectProperty(watchP) && t.isObjectExpression(watchP.value)) {
      watchP.value.properties.forEach((wp) => {
        const k = propKeyName(wp)
        if (k) watchBodies[k] = wp
        else if (t.isObjectProperty(wp) && t.isStringLiteral(wp.key)) watchBodies[wp.key.value] = wp
      })
    }

    LIFECYCLE_HOOKS.forEach((hook) => {
      const hp = optionProp(obj, hook)
      if (!hp) return
      if (!lifecycle[hook]) lifecycle[hook] = []
      lifecycle[hook].push(hp)
    })

    const propsP = optionProp(obj, 'props')
    if (propsP) propsNode = propsP
    const compP = optionProp(obj, 'components')
    if (compP) componentsNode = compP
    const dirP = optionProp(obj, 'directives')
    if (dirP) directivesNode = dirP
    const iaP = optionProp(obj, 'inheritAttrs')
    if (iaP) inheritAttrsNode = iaP
    const modelP = optionProp(obj, 'model')
    if (modelP) modelNode = modelP
    const provideP = optionProp(obj, 'provide')
    if (provideP) provideNode = provideP
    const injectP = optionProp(obj, 'inject')
    if (injectP) injectNode = injectP
    const nameP = optionProp(obj, 'name')
    if (nameP && t.isObjectProperty(nameP) && t.isStringLiteral(nameP.value)) nameVal = nameP.value.value
  })

  return {
    dataKeys,
    dataReturnTypes: extractDataReturnTypes(lastDataProp),
    lastDataProp,
    methodBodies,
    computedBodies,
    watchBodies,
    lifecycle,
    propsNode,
    componentsNode,
    directivesNode,
    inheritAttrsNode,
    modelNode,
    provideNode,
    injectNode,
    nameVal,
    unresolvedMixins,
    filtersMerged,
    filterRenames,
  }
}

function collectImportNames(ast) {
  const names = new Set()
  traverse(ast, {
    ImportDeclaration(p) {
      p.node.specifiers.forEach((s) => {
        if (t.isImportDefaultSpecifier(s) || t.isImportSpecifier(s) || t.isImportNamespaceSpecifier(s)) {
          names.add(s.local.name)
        }
      })
    },
  })
  return names
}

function collectTopLevelLocalNames(ast) {
  const names = new Set()
  ast.program.body.forEach((st) => {
    if (t.isVariableDeclaration(st)) {
      st.declarations.forEach((d) => {
        if (t.isIdentifier(d.id)) names.add(d.id.name)
      })
    } else if ((t.isFunctionDeclaration(st) || t.isClassDeclaration(st)) && st.id) {
      names.add(st.id.name)
    }
  })
  return names
}

// Rough free-identifier scan: skips non-computed member/object keys; good enough to keep
// defineOptions (hoisted out of setup) from referencing script-setup locals.
function referencesAnyName(node, names) {
  if (!names.size) return false
  let hit = false
  const visit = (n, parent, key) => {
    if (hit || !n || typeof n.type !== 'string') return
    if (t.isIdentifier(n)) {
      if (t.isMemberExpression(parent) && key === 'property' && !parent.computed) return
      if ((t.isObjectProperty(parent) || t.isObjectMethod(parent)) && key === 'key' && !parent.computed) return
      if (names.has(n.name)) hit = true
      return
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k.endsWith('Comments')) continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach((c) => visit(c, n, k))
      else if (v && typeof v.type === 'string') visit(v, n, k)
    }
  }
  visit(node, null, null)
  return hit
}

function uniqueName(base, used) {
  let n = base
  let i = 1
  while (used.has(n)) {
    n = base + '_' + i
    i += 1
  }
  used.add(n)
  return n
}

function isArrowMethod(prop) {
  return t.isObjectProperty(prop) && t.isArrowFunctionExpression(prop.value)
}

function methodFunctionNode(prop) {
  if (t.isObjectMethod(prop)) {
    const fn = t.functionExpression(null, prop.params, prop.body, prop.generator, prop.async)
    // Carry existing TS annotations only (never invent)
    if (prop.returnType) fn.returnType = t.cloneNode(prop.returnType, true)
    if (prop.typeParameters) fn.typeParameters = t.cloneNode(prop.typeParameters, true)
    return fn
  }
  if (t.isObjectProperty(prop) && (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value))) {
    return prop.value
  }
  return null
}

/**
 * From data(): { count: number } { … } — map field to TSType (carry only; skip type refs).
 * @returns {Map<string, object>}
 */
function extractDataReturnTypes(dataProp) {
  const map = new Map()
  if (!dataProp) return map
  let fn = null
  if (t.isObjectMethod(dataProp)) fn = dataProp
  else if (
    t.isObjectProperty(dataProp) &&
    (t.isFunctionExpression(dataProp.value) || t.isArrowFunctionExpression(dataProp.value))
  ) {
    fn = dataProp.value
  }
  if (!fn || !fn.returnType || !fn.returnType.typeAnnotation) return map
  const ann = fn.returnType.typeAnnotation
  if (!t.isTSTypeLiteral(ann)) return map
  ;(ann.members || []).forEach((m) => {
    if (!t.isTSPropertySignature(m) || !m.typeAnnotation) return
    const key = t.isIdentifier(m.key) ? m.key.name : t.isStringLiteral(m.key) ? m.key.value : null
    if (!key) return
    map.set(key, m.typeAnnotation.typeAnnotation)
  })
  return map
}

/** ref(init) or ref<ExistingT>(init) — never invent T */
function callRef(init, typeNode) {
  const call = t.callExpression(t.identifier('ref'), [t.cloneNode(init, true)])
  if (typeNode) {
    call.typeParameters = t.tsTypeParameterInstantiation([t.cloneNode(typeNode, true)])
  }
  return call
}

/** Prefer defineAsyncComponent when value is a Vue2 async factory */
function maybeWrapAsyncComponent(expr) {
  if (!expr) return expr
  const wrapped = toDefineAsyncComponent(expr)
  return wrapped || expr
}

/** @returns {{ kind:'fn'|'getset', get?: object, set?: object, fn?: object }} */
function computedParts(prop) {
  if (t.isObjectMethod(prop)) {
    return { kind: 'fn', fn: t.arrowFunctionExpression(prop.params || [], prop.body, prop.async) }
  }
  if (t.isObjectProperty(prop)) {
    if (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)) {
      return { kind: 'fn', fn: prop.value }
    }
    if (t.isObjectExpression(prop.value)) {
      const getP = prop.value.properties.find((x) => propKeyName(x) === 'get')
      const setP = prop.value.properties.find((x) => propKeyName(x) === 'set')
      return {
        kind: 'getset',
        get: getP ? methodFunctionNode(getP) : null,
        set: setP ? methodFunctionNode(setP) : null,
      }
    }
  }
  return null
}

function collectParamNames(params, into) {
  ;(params || []).forEach((p) => {
    if (t.isIdentifier(p)) into.add(p.name)
    else if (t.isAssignmentPattern(p)) collectParamNames([p.left], into)
    else if (t.isRestElement(p)) collectParamNames([p.argument], into)
    else if (t.isObjectPattern(p)) {
      p.properties.forEach((prop) => {
        if (t.isRestElement(prop)) collectParamNames([prop.argument], into)
        else if (t.isObjectProperty(prop)) {
          if (t.isIdentifier(prop.value)) into.add(prop.value.name)
          else if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
            into.add(prop.value.left.name)
          }
        }
      })
    } else if (t.isArrayPattern(p)) {
      p.elements.forEach((el) => {
        if (el) collectParamNames([el], into)
      })
    }
  })
}

function collectShadowingParams(flat) {
  const names = new Set()
  Object.keys(flat.methodBodies).forEach((k) => {
    const fn = methodFunctionNode(flat.methodBodies[k])
    if (fn) collectParamNames(fn.params, names)
  })
  Object.keys(flat.computedBodies).forEach((k) => {
    const parts = computedParts(flat.computedBodies[k])
    if (!parts) return
    if (parts.fn) collectParamNames(parts.fn.params, names)
    if (parts.get) collectParamNames(parts.get.params, names)
    if (parts.set) collectParamNames(parts.set.params, names)
  })
  LIFECYCLE_HOOKS.forEach((hook) => {
    ;(flat.lifecycle[hook] || []).forEach((hp) => {
      const fn = methodFunctionNode(hp)
      if (fn) collectParamNames(fn.params, names)
    })
  })
  return names
}

/**
 * Parse inject option to [{ local, from, defaultNode|null }]
 */
function parseInjectOption(injectNode) {
  const items = []
  if (!injectNode) return items
  const val = t.isObjectProperty(injectNode) ? injectNode.value : null
  if (!val) return items

  if (t.isArrayExpression(val)) {
    val.elements.forEach((el) => {
      if (t.isStringLiteral(el)) items.push({ local: el.value, from: el.value, defaultNode: null })
      else if (t.isIdentifier(el)) items.push({ local: el.name, from: el.name, defaultNode: null })
    })
    return items
  }

  if (t.isObjectExpression(val)) {
    val.properties.forEach((p) => {
      const local = propKeyName(p)
      if (!local || !t.isObjectProperty(p)) return
      if (t.isStringLiteral(p.value) || t.isIdentifier(p.value)) {
        const from = t.isStringLiteral(p.value) ? p.value.value : p.value.name
        items.push({ local, from, defaultNode: null })
      } else if (t.isObjectExpression(p.value)) {
        let from = local
        let defaultNode = null
        p.value.properties.forEach((sp) => {
          const sk = propKeyName(sp)
          if (sk === 'from' && t.isObjectProperty(sp)) {
            if (t.isStringLiteral(sp.value)) from = sp.value.value
            else if (t.isIdentifier(sp.value)) from = sp.value
          }
          if (sk === 'default' && t.isObjectProperty(sp)) defaultNode = sp.value
        })
        items.push({ local, from, defaultNode })
      }
    })
  }
  return items
}

/**
 * Collect local aliases of `this` (`const self = this` / `let that = this`) and rewrite
 * `self.foo` to `this.foo` so the normal this→ref pass can run. Drop unused alias decls.
 */
function expandThisAliases(fnRoot) {
  const aliasNames = new Set()
  const aliasDeclPaths = []
  traverse(t.file(t.program([t.expressionStatement(fnRoot)])), {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || !t.isThisExpression(path.node.init)) return
      aliasNames.add(path.node.id.name)
      aliasDeclPaths.push(path)
    },
  })
  if (!aliasNames.size) return { aliasNames, changed: false }

  let changed = false
  traverse(t.file(t.program([t.expressionStatement(fnRoot)])), {
    MemberExpression(path) {
      if (path.node.computed) return
      if (!t.isIdentifier(path.node.object) || !aliasNames.has(path.node.object.name)) return
      // Do not rewrite the declarator init side
      path.node.object = t.thisExpression()
      changed = true
    },
  })

  // Remove `const self = this` when self is no longer referenced
  aliasDeclPaths.forEach((dp) => {
    const name = dp.node.id.name
    let used = false
    traverse(t.file(t.program([t.expressionStatement(fnRoot)])), {
      Identifier(p) {
        if (p.node.name !== name) return
        if (p.parentPath.isVariableDeclarator() && p.parentPath.node.id === p.node) return
        used = true
      },
    })
    if (used) return
    const decl = dp.parentPath
    if (decl.isVariableDeclaration() && decl.node.declarations.length === 1) decl.remove()
    else dp.remove()
    changed = true
  })

  return { aliasNames, changed }
}

function rewriteThisInFunction(fnNode, ctx) {
  const {
    dataNames,
    computedNames,
    methodNames,
    propNames,
    injectNames,
    templateRefs,
    borrowed,
    nameMap,
    /** When true (provide()), data/computed this.x to ref binding x (not x.value) */
    preferRefBinding,
    refsBagId,
    rootElId,
    dataBagId,
  } = ctx
  const clone = t.cloneNode(fnNode, true)
  expandThisAliases(clone)

  traverse(t.file(t.program([t.expressionStatement(clone)])), {
    MemberExpression(path) {
      if (
        t.isMemberExpression(path.node.object) &&
        t.isThisExpression(path.node.object.object) &&
        t.isIdentifier(path.node.object.property, { name: '$refs' }) &&
        t.isIdentifier(path.node.property) &&
        !path.node.computed
      ) {
        const refName = path.node.property.name
        const mapped = nameMap[refName] || refName
        path.replaceWith(t.memberExpression(t.identifier(mapped), t.identifier('value')))
        path.skip()
        return
      }

      if (!t.isThisExpression(path.node.object)) return
      if (path.node.computed) return
      if (!t.isIdentifier(path.node.property)) return
      const key = path.node.property.name

      // this._xxx: Vue2 does not proxy underscore data onto the instance.
      // data() key to rewrite like other data; custom instance field to per-instance self object;
      // Vue internals (_uid, _isMounted …) to leave for AI.
      if (key.charAt(0) === '_' && !(dataNames && dataNames.has(key))) {
        if (ctx.selfFields && ctx.selfFields.has(key)) {
          path.replaceWith(t.memberExpression(t.identifier(ctx.selfId), t.identifier(key)))
          path.skip()
        }
        return
      }

      if (AI_PARENT.has(key)) return

      // Bridge via setup-captured proxy (methods lose `this` in script setup).
      // $children removed in Vue3 — leave for AI. $parent/$root/$options/$el/$refs still on proxy.
      if (key === '$children') return
      if (key === '$el' || key === '$refs' || key === '$options' || key === '$parent' || key === '$root') {
        const proxyId = (ctx && ctx.proxyId) || '__v23Proxy'
        path.replaceWith(
          t.optionalMemberExpression(t.identifier(proxyId), t.identifier(key), false, true)
        )
        path.skip()
        return
      }

      if (OFFICIAL_DOLLAR[key]) {
        const spec = OFFICIAL_DOLLAR[key]
        if (spec.kind === 'emit') {
          path.replaceWith(t.identifier('emit'))
          return
        }
        if (spec.kind === 'nextTick') {
          path.replaceWith(t.identifier('nextTick'))
          return
        }
        if (spec.kind === 'attrs') {
          path.replaceWith(t.identifier('attrs'))
          return
        }
        if (spec.kind === 'slots') {
          path.replaceWith(t.identifier('slots'))
          return
        }
        if (spec.kind === 'watch') {
          path.replaceWith(t.identifier('watch'))
          return
        }
        if (spec.kind === 'dataBag') {
          path.replaceWith(t.identifier(dataBagId || 'v23Data'))
          return
        }
        if (spec.kind === 'propsBag') {
          path.replaceWith(t.identifier('props'))
          return
        }
        if (spec.kind === 'h') {
          path.replaceWith(t.identifier('h'))
          return
        }
        const instProxyId = (ctx && ctx.proxyId) || '__v23Proxy'
        // Keep `this.$x()` inside the optional chain: `p?.$x()` rather than `(p?.$x)()`.
        const replaceChained = (expr) => {
          const parent = path.parentPath
          if (parent && parent.isCallExpression() && parent.node.callee === path.node) {
            parent.replaceWith(t.optionalCallExpression(expr, parent.node.arguments, false))
            parent.skip()
            return
          }
          path.replaceWith(expr)
          path.skip()
        }
        if (spec.kind === 'vnode') {
          replaceChained(exprInternalInstance(instProxyId, 'vnode'))
          return
        }
        if (spec.kind === 'forceUpdate') {
          replaceChained(exprForceUpdate(instProxyId))
          return
        }
        if (spec.kind === 'destroy') {
          replaceChained(exprDestroyUnmount(instProxyId))
          return
        }
        if (spec.kind === 'isServer') {
          // Vite SSR flag; fallback-friendly boolean expression
          path.replaceWith(
            t.memberExpression(
              t.memberExpression(t.metaProperty(t.identifier('import'), t.identifier('meta')), t.identifier('env')),
              t.identifier('SSR')
            )
          )
          path.skip()
          return
        }
        if (spec.kind === 'ssrContext') {
          path.replaceWith(t.identifier((ctx && ctx.ssrContextId) || '__v23SsrContext'))
          path.skip()
          return
        }
      }

      const mapped = nameMap[key] || key

      if (borrowed) {
        if (dataNames.has(key) || computedNames.has(key)) {
          const foreignRead = t.memberExpression(t.thisExpression(), t.identifier(key))
          const localRead = preferRefBinding
            ? t.identifier(mapped)
            : t.memberExpression(t.identifier(mapped), t.identifier('value'))
          const cond = t.logicalExpression(
            '&&',
            t.thisExpression(),
            t.binaryExpression('in', t.stringLiteral(key), t.thisExpression())
          )
          path.replaceWith(t.conditionalExpression(cond, foreignRead, localRead))
          path.skip()
          return
        }
      }

      if (dataNames.has(key) || computedNames.has(key)) {
        path.replaceWith(
          preferRefBinding
            ? t.identifier(mapped)
            : t.memberExpression(t.identifier(mapped), t.identifier('value'))
        )
        path.skip()
        return
      }
      if (methodNames.has(key)) {
        path.replaceWith(t.identifier(mapped))
        path.skip()
        return
      }
      if (propNames.has(key)) {
        path.replaceWith(t.memberExpression(t.identifier('props'), t.identifier(key)))
        path.skip()
        return
      }
      if (injectNames && injectNames.has(key)) {
        path.replaceWith(t.identifier(mapped))
        path.skip()
        return
      }
      if (templateRefs.has(key)) {
        path.replaceWith(
          preferRefBinding
            ? t.identifier(mapped)
            : t.memberExpression(t.identifier(mapped), t.identifier('value'))
        )
        path.skip()
      }
    },
  })

  return clone
}

/** Detect which special this.$ APIs are used (for helper generation / AI markers). */
/** Options keys that a <script setup> component no longer carries on $options. */
const OPTIONS_GONE_IN_SETUP = new Set([
  'methods',
  'computed',
  'watch',
  'data',
  'mixins',
  'filters',
  'provide',
  'inject',
])

function scanSpecialThisUsage(ast) {
  const usage = {
    bareRefs: false,
    el: false,
    dataBag: false,
    propsBag: false,
    createElement: false,
    vnode: false,
    options: false,
    parent: false,
    root: false,
    children: false,
    forceUpdate: false,
    destroy: false,
    isServer: false,
    ssrContext: false,
    optionsGone: new Set(),
  }
  traverse(ast, {
    MemberExpression(path) {
      if (!t.isThisExpression(path.node.object)) return
      if (path.node.computed || !t.isIdentifier(path.node.property)) return
      const key = path.node.property.name
      if (key === '$el') usage.el = true
      else if (key === '$data') usage.dataBag = true
      else if (key === '$props') usage.propsBag = true
      else if (key === '$createElement') usage.createElement = true
      else if (key === '$vnode') usage.vnode = true
      else if (key === '$options') {
        usage.options = true
        const parent = path.parentPath && path.parentPath.node
        if (
          t.isMemberExpression(parent) &&
          parent.object === path.node &&
          !parent.computed &&
          t.isIdentifier(parent.property) &&
          OPTIONS_GONE_IN_SETUP.has(parent.property.name)
        ) {
          usage.optionsGone.add(parent.property.name)
        }
      } else if (key === '$parent') usage.parent = true
      else if (key === '$root') usage.root = true
      else if (key === '$children') usage.children = true
      else if (key === '$forceUpdate') usage.forceUpdate = true
      else if (key === '$destroy') usage.destroy = true
      else if (key === '$isServer') usage.isServer = true
      else if (key === '$ssrContext') usage.ssrContext = true
      else if (key === '$refs') {
        const parent = path.parentPath && path.parentPath.node
        const isNested =
          t.isMemberExpression(parent) && parent.object === path.node && !parent.computed
        if (!isNested) usage.bareRefs = true
      }
    },
  })
  return usage
}

/** Collect string event names from this.$emit('name', …) for defineEmits. */
function collectEmitEventNames(ast) {
  const events = new Set()
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee
      if (!t.isMemberExpression(callee) || callee.computed) return
      if (!t.isThisExpression(callee.object)) return
      if (!t.isIdentifier(callee.property, { name: '$emit' })) return
      const a0 = path.node.arguments[0]
      if (t.isStringLiteral(a0)) events.add(a0.value)
    },
  })
  return events
}

function buildRefsBag(templateRefs, nameMap) {
  const props = []
  templateRefs.forEach((r) => {
    const id = nameMap[r] || r
    props.push(
      t.objectMethod(
        'get',
        t.identifier(r),
        [],
        t.blockStatement([
          t.returnStatement(t.memberExpression(t.identifier(id), t.identifier('value'))),
        ])
      )
    )
  })
  return t.objectExpression(props)
}

function buildDataBag(dataNames, nameMap) {
  const props = []
  dataNames.forEach((k) => {
    const id = nameMap[k] || k
    props.push(
      t.objectMethod(
        'get',
        t.identifier(k),
        [],
        t.blockStatement([
          t.returnStatement(t.memberExpression(t.identifier(id), t.identifier('value'))),
        ])
      )
    )
    props.push(
      t.objectMethod(
        'set',
        t.identifier(k),
        [t.identifier('v')],
        t.blockStatement([
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.identifier(id), t.identifier('value')),
              t.identifier('v')
            )
          ),
        ])
      )
    )
  })
  return t.objectExpression(props)
}

function toArrow(fn) {
  if (!fn) return null
  if (t.isArrowFunctionExpression(fn)) return fn
  const arrow = t.arrowFunctionExpression(
    fn.params || [],
    t.isBlockStatement(fn.body) ? fn.body : t.blockStatement([t.returnStatement(fn.body)]),
    fn.async
  )
  if (fn.returnType) arrow.returnType = t.cloneNode(fn.returnType, true)
  if (fn.typeParameters) arrow.typeParameters = t.cloneNode(fn.typeParameters, true)
  return arrow
}

/** Copy existing TS annotations onto a newly built function (carry only). */
function copyTsAnnos(from, to) {
  if (!from || !to) return to
  if (from.returnType) to.returnType = t.cloneNode(from.returnType, true)
  if (from.typeParameters) to.typeParameters = t.cloneNode(from.typeParameters, true)
  return to
}

function watchSourceForKey(key, dataNames, computedNames, nameMap, propNames) {
  const parts = String(key).split('.')
  const root = parts[0]
  const mapped = nameMap[root] || root
  if (propNames && propNames.has(root)) {
    let expr = t.memberExpression(t.identifier('props'), t.identifier(root))
    for (let i = 1; i < parts.length; i++) {
      expr = t.memberExpression(expr, t.identifier(parts[i]))
    }
    return t.arrowFunctionExpression([], expr)
  }
  if (parts.length === 1 && (dataNames.has(root) || computedNames.has(root))) {
    return t.identifier(mapped)
  }
  if (dataNames.has(root) || computedNames.has(root)) {
    let expr = t.memberExpression(t.identifier(mapped), t.identifier('value'))
    for (let i = 1; i < parts.length; i++) {
      expr = t.memberExpression(expr, t.identifier(parts[i]))
    }
    return t.arrowFunctionExpression([], expr)
  }
  // Unknown root — string source (Vue3 watch still accepts getter; use arrow reading global-ish)
  return t.arrowFunctionExpression([], t.identifier(root))
}

function usesThisDollarEmit(code) {
  return /this\s*\.\s*\$emit\b/.test(String(code || ''))
}
function usesThisDollarNextTick(code) {
  return /this\s*\.\s*\$nextTick\b/.test(String(code || ''))
}
function usesThisDollarAttrs(code) {
  return /this\s*\.\s*\$attrs\b/.test(String(code || ''))
}
function usesThisDollarSlots(code) {
  return /this\s*\.\s*\$slots\b/.test(String(code || ''))
}
function usesThisDollarWatch(code) {
  return /this\s*\.\s*\$watch\b/.test(String(code || ''))
}

/**
 * @param {string} code
 * @param {{ filename?: string }} [opts]
 */
function migrateOptionsToComposition(code, opts) {
  const changes = []
  const filename = (opts && opts.filename) || 'anon.js'
  const rebinding = analyzeThisRebinding(code, filename)
  const underscore = analyzeThisUnderscore(code, filename)
  changes.push({
    kind: 'this-rebinding-analysis',
    sites: rebinding.sites.length,
    borrowedMethods: Array.from(rebinding.borrowedMethods),
  })
  if (underscore.sites.length) {
    changes.push({
      kind: 'this-underscore-analysis',
      sites: underscore.sites.length,
      names: underscore.sites.map((s) => s.name),
      custom: underscore.sites.filter((s) => s.kind === 'custom-or-unknown').map((s) => s.name),
      vueInternal: underscore.sites.filter((s) => s.kind === 'vue-internal').map((s) => s.name),
    })
  }

  let ast
  try {
    ast = parse(code)
  } catch (e) {
    return { code: String(code || ''), changes, rebinding, underscore, error: String(e && e.message) }
  }

  if (/^\s*\/\*\s*v23:composition\s*\*\//.test(code)) {
    return { code, changes, rebinding, skipped: 'already-migrated' }
  }

  const opt = getOptionsObject(ast)
  if (!opt) {
    return { code, changes, rebinding, skipped: 'no-options-object' }
  }

  if (optionProp(opt.node, 'setup')) {
    return { code, changes, rebinding, skipped: 'has-setup' }
  }

  const localObjects = collectLocalObjects(ast)
  const flat = flattenMixins(opt.node, localObjects)

  // Imported mixins / extends cannot be flattened from this file; script setup would drop
  // their state. Vue3 Options API still supports both, so keep Options and hand off to AI.
  const hasExtends = !!optionProp(opt.node, 'extends')
  if (flat.unresolvedMixins.length || hasExtends) {
    const reasons = []
    if (flat.unresolvedMixins.length) reasons.push('unresolved mixins: ' + flat.unresolvedMixins.join(', '))
    if (hasExtends) reasons.push('options.extends')
    // Options code stays as-is, so Vue2-only instance APIs would break at runtime in Vue3.
    const usage = scanSpecialThisUsage(ast)
    const removedApis = []
    if (usage.createElement) removedApis.push('$createElement')
    if (usage.vnode) removedApis.push('$vnode')
    if (usage.destroy) removedApis.push('$destroy')
    if (usage.children) removedApis.push('$children')
    ;(underscore.sites || [])
      .filter((s) => s.kind === 'vue-internal')
      .forEach((s) => {
        if (!removedApis.includes(s.name)) removedApis.push(s.name)
      })
    const removedNote = removedApis.length
      ? '; Vue2-only instance APIs used: ' + removedApis.join(', ') + ' — rewrite for Vue3'
      : ''
    const note =
      '/* AI-TODO: [options-to-composition] kept Options API (' +
      reasons.join('; ') +
      ') — Vue3 still supports mixins/extends; convert to composables + script setup manually if desired' +
      removedNote +
      ' */\n'
    changes.push({ kind: 'keep-options', reasons, removedApis })
    return {
      code: /kept Options API/.test(code) ? code : note + code,
      changes,
      rebinding,
      skipped: 'keep-options',
    }
  }

  flat.filtersMerged.forEach((k) => changes.push({ kind: 'filters-to-methods', name: k }))
  Object.keys(flat.filterRenames || {}).forEach((from) => {
    changes.push({
      kind: 'filters-rename-dup',
      from,
      to: flat.filterRenames[from],
      note: 'method kept; filter stored as ' + flat.filterRenames[from],
    })
  })

  const importNames = collectImportNames(ast)
  const used = new Set(importNames)
  ;[
    'ref',
    'computed',
    'watch',
    'provide',
    'inject',
    'onMounted',
    'onBeforeMount',
    'onBeforeUpdate',
    'onUpdated',
    'onActivated',
    'onDeactivated',
    'onBeforeUnmount',
    'onUnmounted',
    'onErrorCaptured',
    'nextTick',
    'useAttrs',
    'useSlots',
    'emit',
    'props',
    'attrs',
    'slots',
    'h',
    'getCurrentInstance',
    'v23Refs',
    'v23Data',
    'rootEl',
    'defineProps',
    'defineEmits',
    'defineOptions',
  ].forEach((n) => used.add(n))

  const specialUsage = scanSpecialThisUsage(ast)

  const injectItems = parseInjectOption(flat.injectNode)
  const injectNames = new Set(injectItems.map((i) => i.local))

  const dataNames = new Set(Object.keys(flat.dataKeys))
  const computedNames = new Set(Object.keys(flat.computedBodies))
  const methodNames = new Set(Object.keys(flat.methodBodies))
  const propNames = new Set()
  if (flat.propsNode && t.isObjectProperty(flat.propsNode) && t.isObjectExpression(flat.propsNode.value)) {
    flat.propsNode.value.properties.forEach((p) => {
      const k = propKeyName(p)
      if (k) propNames.add(k)
    })
  } else if (flat.propsNode && t.isObjectProperty(flat.propsNode) && t.isArrayExpression(flat.propsNode.value)) {
    flat.propsNode.value.elements.forEach((el) => {
      if (t.isStringLiteral(el)) propNames.add(el.value)
    })
  }

  const shadowParams = collectShadowingParams(flat)
  shadowParams.forEach((n) => used.add(n))
  injectNames.forEach((n) => used.add(n))

  const nameMap = Object.create(null)
  injectItems.forEach((it) => {
    nameMap[it.local] = it.local
  })

  const allMembers = [].concat(Array.from(dataNames), Array.from(computedNames), Array.from(methodNames))
  allMembers.forEach((k) => {
    if (used.has(k) || importNames.has(k)) {
      const next = uniqueName(k, used)
      nameMap[k] = next
      if (next !== k) changes.push({ kind: 'rename-shadow', from: k, to: next, reason: 'param-or-import' })
    } else {
      used.add(k)
      nameMap[k] = k
    }
  })

  const templateRefs = new Set()
  traverse(ast, {
    MemberExpression(p) {
      if (
        t.isMemberExpression(p.node.object) &&
        t.isThisExpression(p.node.object.object) &&
        t.isIdentifier(p.node.object.property, { name: '$refs' }) &&
        t.isIdentifier(p.node.property) &&
        !p.node.computed
      ) {
        templateRefs.add(p.node.property.name)
      }
    },
  })

  const setupStmts = []
  const returnEntries = []
  const vueImports = new Set()

  function pushReturn(expose, id) {
    if (returnEntries.some((e) => e.expose === expose)) return
    returnEntries.push({ expose, id })
  }

  const refsBagId = 'v23Refs'
  const rootElId = 'rootEl'
  const dataBagId = 'v23Data'
  const proxyId = '__v23Proxy'
  const selfId = '__v23Self'
  const ssrContextId = '__v23SsrContext'
  const selfFields = new Set(
    (underscore.sites || [])
      .filter((s) => s.kind === 'custom-or-unknown' && !dataNames.has(s.name))
      .map((s) => s.name)
  )
  const needProxyBridge = !!(
    specialUsage.el ||
    specialUsage.bareRefs ||
    specialUsage.options ||
    specialUsage.parent ||
    specialUsage.root ||
    specialUsage.vnode ||
    specialUsage.forceUpdate ||
    specialUsage.destroy
  )
  const rewriteCtxBase = {
    dataNames,
    computedNames,
    methodNames,
    propNames,
    injectNames,
    templateRefs,
    nameMap,
    refsBagId,
    rootElId,
    dataBagId,
    proxyId,
    selfFields,
    selfId,
    ssrContextId,
  }

  // useSSRContext() is an inject — setup-only, and it warns on the client. Vue2 $ssrContext was
  // undefined in the browser, so only call it in SSR builds.
  if (specialUsage.ssrContext) {
    vueImports.add('useSSRContext')
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(ssrContextId),
          t.conditionalExpression(
            t.memberExpression(
              t.memberExpression(t.metaProperty(t.identifier('import'), t.identifier('meta')), t.identifier('env')),
              t.identifier('SSR')
            ),
            t.callExpression(t.identifier('useSSRContext'), []),
            t.identifier('undefined')
          )
        ),
      ])
    )
  }

  // Custom non-data instance fields (this._timer = …) were plain, non-reactive slots in Vue2;
  // keep them on a per-instance object so free functions in script setup can still share them.
  if (selfFields.size) {
    setupStmts.push(
      t.variableDeclaration('const', [t.variableDeclarator(t.identifier(selfId), t.objectExpression([]))])
    )
    changes.push({ kind: 'this-underscore-self', names: Array.from(selfFields) })
  }

  // Capture public instance once in setup so later method calls can read $el / bare $refs
  // without relying on `this` (undefined in <script setup> free functions).
  if (needProxyBridge) {
    vueImports.add('getCurrentInstance')
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(proxyId),
          t.optionalMemberExpression(
            t.callExpression(t.identifier('getCurrentInstance'), []),
            t.identifier('proxy'),
            false,
            true
          )
        ),
      ])
    )
  }

  // inject first
  injectItems.forEach((it) => {
    vueImports.add('inject')
    const id = nameMap[it.local] || it.local
    const fromArg = typeof it.from === 'string' ? t.stringLiteral(it.from) : it.from
    const args = [fromArg]
    if (it.defaultNode) args.push(t.cloneNode(it.defaultNode, true))
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(id), t.callExpression(t.identifier('inject'), args)),
      ])
    )
    pushReturn(it.local, id)
    changes.push({ kind: 'inject', name: it.local, from: typeof it.from === 'string' ? it.from : 'symbol' })
  })

  // data to ref (IIFE when prelude/shorthand/this; else rewrite this.prop to props.prop)
  const dataInitId = '__v23DataInit'
  const hostDataKeys = flat.lastDataProp ? keysFromDataReturn(flat.lastDataProp) : new Set()
  const useDataIife = !!(flat.lastDataProp && dataFnNeedsIife(flat.lastDataProp))
  if (useDataIife) {
    const rewrittenFn = rewriteDataFnThisToProps(flat.lastDataProp, propNames)
    if (rewrittenFn) {
      let iifeBody
      if (t.isBlockStatement(rewrittenFn.body)) {
        iifeBody = rewrittenFn.body
      } else {
        iifeBody = t.blockStatement([t.returnStatement(rewrittenFn.body)])
      }
      setupStmts.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(dataInitId),
            t.callExpression(t.arrowFunctionExpression([], iifeBody), [])
          ),
        ])
      )
      changes.push({ kind: 'data-iife-init', note: 'data() prelude/shorthand/this to IIFE then ref()' })
    }
  }

  Object.keys(flat.dataKeys).forEach((k) => {
    const dp = flat.dataKeys[k]
    let init = t.identifier('undefined')
    if (useDataIife && hostDataKeys.has(k)) {
      init = t.memberExpression(t.identifier(dataInitId), t.identifier(k))
    } else if (t.isObjectProperty(dp)) {
      init = rewriteDataInitExpr(dp.value, propNames)
    }
    const id = nameMap[k] || k
    vueImports.add('ref')
    const typeNode = flat.dataReturnTypes && flat.dataReturnTypes.get(k)
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(id), callRef(init, typeNode || null)),
      ])
    )
    pushReturn(k, id)
    changes.push({
      kind: 'data-to-ref',
      name: k,
      as: id,
      typed: Boolean(typeNode),
      viaIife: useDataIife && hostDataKeys.has(k),
    })
  })

  templateRefs.forEach((r) => {
    if (dataNames.has(r) || methodNames.has(r) || computedNames.has(r) || injectNames.has(r)) return
    const id = nameMap[r] || uniqueName(r, used)
    nameMap[r] = id
    vueImports.add('ref')
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(id), t.callExpression(t.identifier('ref'), [t.nullLiteral()])),
      ])
    )
    pushReturn(r, id)
  })

  // this.$el / bare this.$refs to __v23Proxy bridge (+ AI note: prefer explicit template refs)
  if (specialUsage.el) {
    changes.push({
      kind: 'this-$el-proxy',
      note: 'this.$el to __v23Proxy?.$el (setup-captured getCurrentInstance().proxy)',
    })
  }
  if (specialUsage.bareRefs) {
    changes.push({
      kind: 'this-$refs-proxy',
      note: 'bare this.$refs to __v23Proxy?.$refs (prefer explicit template refs when possible)',
    })
  }

  // this.$data to v23Data getters/setters
  if (specialUsage.dataBag) {
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(dataBagId), buildDataBag(dataNames, nameMap)),
      ])
    )
    changes.push({ kind: 'this-$data', keys: Array.from(dataNames) })
  }

  if (specialUsage.createElement) {
    vueImports.add('h')
    changes.push({ kind: 'this-$createElement', note: 'this.$createElement to h' })
  }
  if (specialUsage.vnode) {
    changes.push({ kind: 'this-$vnode', note: 'this.$vnode to __v23Proxy?.$.vnode' })
  }
  if (specialUsage.forceUpdate) {
    changes.push({
      kind: 'this-$forceUpdate',
      note: 'this.$forceUpdate to __v23Proxy?.$forceUpdate',
    })
  }
  if (specialUsage.destroy) {
    changes.push({
      kind: 'this-$destroy',
      note: 'this.$destroy to __v23Proxy?.$.appContext.app.unmount (root-oriented; child to prefer v-if / AI)',
    })
  }
  if (specialUsage.isServer) {
    changes.push({ kind: 'this-$isServer', note: 'this.$isServer to import.meta.env.SSR' })
  }
  if (specialUsage.ssrContext) {
    changes.push({ kind: 'this-$ssrContext', note: 'this.$ssrContext to __v23SsrContext (useSSRContext() in setup, SSR only)' })
  }
  if (specialUsage.propsBag) {
    changes.push({ kind: 'this-$props', note: 'this.$props to props' })
  }
  if (specialUsage.options) {
    changes.push({
      kind: 'this-$options-proxy',
      note: 'this.$options to __v23Proxy?.$options (shape may differ in script setup)',
    })
  }
  if (specialUsage.parent) {
    changes.push({ kind: 'this-$parent-proxy', note: 'this.$parent to __v23Proxy?.$parent' })
  }
  if (specialUsage.root) {
    changes.push({ kind: 'this-$root-proxy', note: 'this.$root to __v23Proxy?.$root' })
  }
  if (specialUsage.children) {
    changes.push({
      kind: 'ai-this-$children',
      note: 'this.$children removed in Vue3 — AI must use template refs / provide',
    })
  }

  // computed (get/set)
  Object.keys(flat.computedBodies).forEach((k) => {
    vueImports.add('computed')
    const parts = computedParts(flat.computedBodies[k])
    if (!parts) return
    const id = nameMap[k] || k
    let arg
    if (parts.kind === 'getset' && (parts.get || parts.set)) {
      const props = []
      if (parts.get) {
        const g = rewriteThisInFunction(parts.get, Object.assign({}, rewriteCtxBase, { borrowed: false }))
        props.push(t.objectProperty(t.identifier('get'), toArrow(g)))
      }
      if (parts.set) {
        const s = rewriteThisInFunction(parts.set, Object.assign({}, rewriteCtxBase, { borrowed: false }))
        props.push(t.objectProperty(t.identifier('set'), toArrow(s)))
      }
      arg = t.objectExpression(props)
      changes.push({ kind: 'computed-getset', name: k, as: id })
    } else if (parts.fn) {
      const rewritten = rewriteThisInFunction(parts.fn, Object.assign({}, rewriteCtxBase, { borrowed: false }))
      arg = toArrow(rewritten)
      changes.push({ kind: 'computed', name: k, as: id })
    } else {
      return
    }
    setupStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(id), t.callExpression(t.identifier('computed'), [arg])),
      ])
    )
    pushReturn(k, id)
  })

  // methods
  Object.keys(flat.methodBodies).forEach((k) => {
    const prop = flat.methodBodies[k]
    if (isArrowMethod(prop)) {
      changes.push({
        kind: 'arrow-method-skip-bind',
        name: k,
        note: 'Options arrow method lexical this is not component; body still rewritten for this.member',
      })
    }
    const fn = methodFunctionNode(prop)
    if (!fn) return
    const id = nameMap[k] || k
    const borrowed = rebinding.borrowedMethods.has(k)
    if (borrowed) {
      changes.push({ kind: 'borrowed-method', name: k, note: 'call/apply/bind foreign thisArg recorded' })
    }
    const rewritten = rewriteThisInFunction(fn, Object.assign({}, rewriteCtxBase, { borrowed }))
    const decl = copyTsAnnos(
      rewritten,
      t.functionDeclaration(
        t.identifier(id),
        rewritten.params || [],
        t.isBlockStatement(rewritten.body)
          ? rewritten.body
          : t.blockStatement([t.returnStatement(rewritten.body)]),
        rewritten.generator,
        rewritten.async
      )
    )
    setupStmts.push(decl)
    pushReturn(k, id)
    changes.push({ kind: 'method', name: k, as: id, borrowed })
  })

  // watch
  Object.keys(flat.watchBodies).forEach((key) => {
    vueImports.add('watch')
    const prop = flat.watchBodies[key]
    const source = watchSourceForKey(key, dataNames, computedNames, nameMap, propNames)
    let handlerFn = null
    let optsObj = null

    if (t.isObjectMethod(prop) || (t.isObjectProperty(prop) && (t.isFunctionExpression(prop.value) || t.isArrowFunctionExpression(prop.value)))) {
      handlerFn = methodFunctionNode(prop)
    } else if (t.isObjectProperty(prop) && t.isStringLiteral(prop.value)) {
      const m = nameMap[prop.value.value] || prop.value.value
      handlerFn = t.identifier(m)
    } else if (t.isObjectProperty(prop) && t.isObjectExpression(prop.value)) {
      const opts = prop.value
      let handlerProp = opts.properties.find((x) => propKeyName(x) === 'handler')
      const deepP = opts.properties.find((x) => propKeyName(x) === 'deep')
      const immP = opts.properties.find((x) => propKeyName(x) === 'immediate')
      if (handlerProp) {
        if (t.isObjectProperty(handlerProp) && t.isStringLiteral(handlerProp.value)) {
          handlerFn = t.identifier(nameMap[handlerProp.value.value] || handlerProp.value.value)
        } else {
          handlerFn = methodFunctionNode(handlerProp)
        }
      }
      const optProps = []
      if (deepP && t.isObjectProperty(deepP)) optProps.push(t.objectProperty(t.identifier('deep'), deepP.value))
      if (immP && t.isObjectProperty(immP)) {
        optProps.push(t.objectProperty(t.identifier('immediate'), immP.value))
      }
      if (optProps.length) optsObj = t.objectExpression(optProps)
    }

    if (!handlerFn) {
      changes.push({ kind: 'watch-skip', key, note: 'unrecognized watch shape' })
      return
    }

    let handlerArg = handlerFn
    if (!t.isIdentifier(handlerFn)) {
      const rewritten = rewriteThisInFunction(handlerFn, Object.assign({}, rewriteCtxBase, { borrowed: false }))
      handlerArg = toArrow(rewritten)
    }

    const args = [source, handlerArg]
    if (optsObj) args.push(optsObj)
    setupStmts.push(t.expressionStatement(t.callExpression(t.identifier('watch'), args)))
    changes.push({ kind: 'watch', key })
  })

  // provide (after data/methods so refs exist)
  if (flat.provideNode) {
    vueImports.add('provide')
    const pn = flat.provideNode
    let providedObj = null
    if (t.isObjectProperty(pn) && t.isObjectExpression(pn.value)) {
      providedObj = pn.value
    } else {
      const fn = methodFunctionNode(pn)
      if (fn) {
        const rewritten = rewriteThisInFunction(
          fn,
          Object.assign({}, rewriteCtxBase, { borrowed: false, preferRefBinding: true })
        )
        // Prefer return { ... } static extraction
        if (t.isBlockStatement(rewritten.body)) {
          const ret = rewritten.body.body.find((s) => t.isReturnStatement(s) && t.isObjectExpression(s.argument))
          if (ret) providedObj = ret.argument
        } else if (t.isObjectExpression(rewritten.body)) {
          providedObj = rewritten.body
        }
      }
    }

    if (providedObj && t.isObjectExpression(providedObj)) {
      providedObj.properties.forEach((pp) => {
        const k = propKeyName(pp)
        if (!k || !t.isObjectProperty(pp)) return
        let val = t.cloneNode(pp.value, true)
        // If still this.xxx in value (object-literal provide), rewrite via tiny wrap
        if (t.isMemberExpression(val) && t.isThisExpression(val.object) && t.isIdentifier(val.property)) {
          const mk = val.property.name
          const mapped = nameMap[mk] || mk
          if (dataNames.has(mk) || computedNames.has(mk)) {
            val = t.identifier(mapped) // provide the ref itself
          } else if (injectNames.has(mk) || methodNames.has(mk)) {
            val = t.identifier(mapped)
          } else if (propNames.has(mk)) {
            val = t.memberExpression(t.identifier('props'), t.identifier(mk))
          }
        }
        let primitiveWrapped = false
        if (isPrimitiveNode(val)) {
          vueImports.add('ref')
          val = t.callExpression(t.identifier('ref'), [val])
          primitiveWrapped = true
          changes.push({
            kind: 'provide-primitive-ref',
            name: k,
            note:
              'wrapped primitive provide in ref; inject callers that treated the value as a raw string/number must use .value (auto=partial)',
          })
        }
        setupStmts.push(
          t.expressionStatement(
            t.callExpression(t.identifier('provide'), [t.stringLiteral(k), val])
          )
        )
        changes.push({ kind: 'provide', name: k, primitiveWrapped })
      })
    } else {
      changes.push({
        kind: 'provide-ai',
        note: 'complex provide() body — AI-TODO',
      })
    }
  }

  // beforeCreate to inline before created. Vue2 beforeCreate could not see data/props/methods,
  // so running after the ref declarations does not change observable behavior.
  ;(flat.lifecycle.beforeCreate || []).forEach((hp) => {
    const fn = methodFunctionNode(hp)
    if (!fn) return
    const rewritten = rewriteThisInFunction(fn, Object.assign({}, rewriteCtxBase, { borrowed: false }))
    if (t.isBlockStatement(rewritten.body)) {
      setupStmts.push(...rewritten.body.body)
    } else {
      setupStmts.push(t.expressionStatement(rewritten.body))
    }
    changes.push({ kind: 'lifecycle', from: 'beforeCreate', to: 'setup-inline' })
  })

  // created to inline
  ;(flat.lifecycle.created || []).forEach((hp) => {
    const fn = methodFunctionNode(hp)
    if (!fn) return
    const rewritten = rewriteThisInFunction(fn, Object.assign({}, rewriteCtxBase, { borrowed: false }))
    if (t.isBlockStatement(rewritten.body)) {
      setupStmts.push(...rewritten.body.body)
    } else {
      setupStmts.push(t.expressionStatement(rewritten.body))
    }
    changes.push({ kind: 'lifecycle', from: 'created', to: 'setup-inline' })
  })

  function appendHook(hookName, vueHook) {
    const list = flat.lifecycle[hookName] || []
    if (!list.length) return
    vueImports.add(vueHook)
    list.forEach((hp) => {
      const fn = methodFunctionNode(hp)
      if (!fn) return
      const rewritten = rewriteThisInFunction(fn, Object.assign({}, rewriteCtxBase, { borrowed: false }))
      // errorCaptured keeps (err, instance, info) params
      const params =
        hookName === 'errorCaptured' && rewritten.params && rewritten.params.length
          ? rewritten.params
          : []
      const hookArrow = t.arrowFunctionExpression(
        params,
        t.isBlockStatement(rewritten.body) ? rewritten.body : t.blockStatement([t.returnStatement(rewritten.body)]),
        rewritten.async
      )
      setupStmts.push(t.expressionStatement(t.callExpression(t.identifier(vueHook), [hookArrow])))
      changes.push({ kind: 'lifecycle', from: hookName, to: vueHook })
    })
  }

  Object.keys(LIFECYCLE_TO_VUE).forEach((hook) => appendHook(hook, LIFECYCLE_TO_VUE[hook]))

  const codeStr = String(code)
  const needsEmit = usesThisDollarEmit(codeStr)
  const needsNextTick = usesThisDollarNextTick(codeStr)
  const needsAttrs = usesThisDollarAttrs(codeStr)
  const needsSlots = usesThisDollarSlots(codeStr)
  const needsWatchApi = usesThisDollarWatch(codeStr) || Object.keys(flat.watchBodies).length > 0
  if (needsNextTick) vueImports.add('nextTick')
  if (needsAttrs) vueImports.add('useAttrs')
  if (needsSlots) vueImports.add('useSlots')
  if (needsWatchApi) vueImports.add('watch')

  if (flat.modelNode) {
    changes.push({
      kind: 'ai-model',
      note: 'options.model to AI (prop/event ↔ modelValue / update:modelValue)',
    })
  }

  // ——— assemble <script setup> body (no defineComponent / no return) ———
  const preludeStmts = []

  const defineOptionsProps = []
  if (flat.nameVal) {
    defineOptionsProps.push(t.objectProperty(t.identifier('name'), t.stringLiteral(flat.nameVal)))
  }
  if (flat.inheritAttrsNode && t.isObjectProperty(flat.inheritAttrsNode)) {
    defineOptionsProps.push(t.objectProperty(t.identifier('inheritAttrs'), flat.inheritAttrsNode.value))
  }

  // components: imports are registered by name; non-import factories are inlined into
  // defineOptions (it is hoisted out of setup and cannot see script-setup locals), so
  // string :is="'Foo'" and <Foo> tags keep resolving. Factories that reference module
  // locals fall back to a const (tag usage only).
  const componentRegisterNames = []
  const componentInlineProps = []
  const componentHoistStmts = []
  const moduleLocalNames = collectTopLevelLocalNames(ast)
  if (flat.componentsNode && t.isObjectProperty(flat.componentsNode) && t.isObjectExpression(flat.componentsNode.value)) {
    flat.componentsNode.value.properties.forEach((cp) => {
      const k = propKeyName(cp)
      if (!k || !t.isObjectProperty(cp)) return
      let init = cp.value
      if (t.isIdentifier(init) && init.name === k) {
        if (moduleLocalNames.has(k)) {
          changes.push({ kind: 'components-script-setup', name: k, register: false, note: 'module-local const — tag usage only' })
          return
        }
        componentRegisterNames.push(k)
        changes.push({
          kind: 'components-script-setup',
          name: k,
          note: 'same-name import — register in defineOptions.components for string :is',
        })
        return
      }
      const wrapped = maybeWrapAsyncComponent(init)
      const isAsync = wrapped !== init
      if (isAsync) vueImports.add('defineAsyncComponent')
      if (referencesAnyName(wrapped, moduleLocalNames)) {
        componentHoistStmts.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier(k), t.cloneNode(wrapped, true)),
          ])
        )
        changes.push({ kind: isAsync ? 'components-async-hoist' : 'components-hoist', name: k, register: false })
        return
      }
      componentInlineProps.push(t.objectProperty(t.identifier(k), t.cloneNode(wrapped, true)))
      changes.push({ kind: isAsync ? 'components-async-inline' : 'components-inline', name: k })
    })
  } else if (flat.componentsNode) {
    changes.push({
      kind: 'components-script-setup',
      note: 'components option dropped; ensure imports remain (script setup auto-register)',
    })
  }

  if (componentRegisterNames.length || componentInlineProps.length) {
    defineOptionsProps.push(
      t.objectProperty(
        t.identifier('components'),
        t.objectExpression([
          ...componentRegisterNames.map((n) =>
            t.objectProperty(t.identifier(n), t.identifier(n), false, true)
          ),
          ...componentInlineProps,
        ])
      )
    )
  }

  // Hoist component consts before defineOptions (components: { Foo } needs Foo in scope)
  componentHoistStmts.forEach((s) => preludeStmts.push(s))

  if (defineOptionsProps.length) {
    preludeStmts.push(
      t.expressionStatement(
        t.callExpression(t.identifier('defineOptions'), [t.objectExpression(defineOptionsProps)])
      )
    )
    changes.push({ kind: 'defineOptions', keys: defineOptionsProps.map((p) => propKeyName(p)) })
  }

  if (flat.propsNode && t.isObjectProperty(flat.propsNode)) {
    preludeStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('props'),
          t.callExpression(t.identifier('defineProps'), [flat.propsNode.value])
        ),
      ])
    )
    changes.push({ kind: 'defineProps' })
  } else if (specialUsage.propsBag) {
    preludeStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier('props'), t.callExpression(t.identifier('defineProps'), [t.objectExpression([])])),
      ])
    )
    changes.push({ kind: 'defineProps', note: 'empty — this.$props used without props option' })
  }

  if (needsEmit) {
    const emitEvents = collectEmitEventNames(ast)
    const emitList = Array.from(emitEvents).map((e) => t.stringLiteral(e))
    preludeStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('emit'),
          t.callExpression(t.identifier('defineEmits'), [t.arrayExpression(emitList)])
        ),
      ])
    )
    changes.push({ kind: 'defineEmits', events: Array.from(emitEvents) })
  }

  // directives to const vFocus = { ... }
  if (flat.directivesNode && t.isObjectProperty(flat.directivesNode) && t.isObjectExpression(flat.directivesNode.value)) {
    flat.directivesNode.value.properties.forEach((dp) => {
      const k = propKeyName(dp)
      if (!k) return
      const vName = 'v' + k.charAt(0).toUpperCase() + k.slice(1)
      let init = t.identifier('undefined')
      if (t.isObjectProperty(dp)) init = dp.value
      else if (t.isObjectMethod(dp)) {
        init = t.functionExpression(null, dp.params, dp.body, dp.generator, dp.async)
      }
      preludeStmts.push(
        t.variableDeclaration('const', [t.variableDeclarator(t.identifier(vName), t.cloneNode(init, true))])
      )
      changes.push({ kind: 'directive-script-setup', from: k, to: vName })
    })
  }

  if (needsAttrs) {
    preludeStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier('attrs'), t.callExpression(t.identifier('useAttrs'), [])),
      ])
    )
  }
  if (needsSlots) {
    preludeStmts.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier('slots'), t.callExpression(t.identifier('useSlots'), [])),
      ])
    )
  }

  const setupBodyStmts = preludeStmts.concat(setupStmts)

  // Template-facing aliases when data/method was renamed (expose !== id)
  returnEntries.forEach((e) => {
    if (e.expose === e.id) return
    // An import already owns this name — redeclaring it is a SyntaxError; template reads the import.
    if (importNames.has(e.expose)) {
      changes.push({ kind: 'script-setup-alias-skip', from: e.id, to: e.expose, reason: 'import-binding' })
      return
    }
    setupBodyStmts.push(
      t.variableDeclaration('const', [t.variableDeclarator(t.identifier(e.expose), t.identifier(e.id))])
    )
    changes.push({ kind: 'script-setup-alias', from: e.id, to: e.expose })
  })

  // Parent $refs.child.method() needs defineExpose in <script setup>
  const exposeProps = []
  const exposeSeen = new Set()
  function pushExpose(name, id) {
    if (!name || exposeSeen.has(name)) return
    exposeSeen.add(name)
    exposeProps.push(t.objectProperty(t.identifier(name), t.identifier(id || name), false, name === (id || name)))
  }
  Object.keys(flat.methodBodies).forEach((k) => pushExpose(k, nameMap[k] || k))
  Object.keys(flat.dataKeys).forEach((k) => pushExpose(k, nameMap[k] || k))
  Object.keys(flat.computedBodies).forEach((k) => pushExpose(k, nameMap[k] || k))
  if (exposeProps.length) {
    setupBodyStmts.push(
      t.expressionStatement(
        t.callExpression(t.identifier('defineExpose'), [t.objectExpression(exposeProps)])
      )
    )
    changes.push({ kind: 'defineExpose', keys: Array.from(exposeSeen) })
  }

  if (specialUsage.children || /\$children\b/.test(codeStr)) {
    changes.push({
      kind: 'ai-instance-tree',
      note: 'this.$children left for AI (removed in Vue3)',
    })
  }

  const vueImportNames = Array.from(vueImports).filter((n) => n !== 'defineComponent')
  const newBody = []
  ast.program.body.forEach((stmt) => {
    if (t.isImportDeclaration(stmt)) newBody.push(stmt)
    else if (t.isExportNamedDeclaration(stmt)) newBody.push(stmt)
    else if (t.isExportDefaultDeclaration(stmt)) {
      /* dropped — script setup has no export default */
    } else if (t.isFunctionDeclaration(stmt) || t.isVariableDeclaration(stmt)) {
      newBody.push(stmt)
    }
  })

  let mergedVue = false
  newBody.forEach((stmt, idx) => {
    if (t.isImportDeclaration(stmt) && stmt.source.value === 'vue') {
      const have = new Set(stmt.specifiers.map((s) => (s.local && s.local.name) || ''))
      // Strip defineComponent if present
      stmt.specifiers = stmt.specifiers.filter((s) => !(s.local && s.local.name === 'defineComponent'))
      vueImportNames.forEach((n) => {
        if (!have.has(n)) stmt.specifiers.push(t.importSpecifier(t.identifier(n), t.identifier(n)))
      })
      mergedVue = true
      newBody[idx] = stmt
    }
  })
  if (!mergedVue && vueImportNames.length) {
    newBody.unshift(
      t.importDeclaration(
        vueImportNames.map((n) => t.importSpecifier(t.identifier(n), t.identifier(n))),
        t.stringLiteral('vue')
      )
    )
  }

  setupBodyStmts.forEach((s) => newBody.push(s))

  let out = gen(t.program(newBody, [], 'module'))
  changes.push({ kind: 'script-setup', note: 'emitted <script setup> style (no defineComponent)' })

  if (rebinding.sites.length) {
    out =
      '/* v23:this-rebinding ' +
      JSON.stringify(
        rebinding.sites.map((s) => ({
          kind: s.kind,
          method: s.methodHint,
          incomingThis: s.incomingThis,
          thisArg: s.thisArgCode,
          line: s.loc && s.loc.line,
        }))
      ) +
      ' */\n' +
      out
  }
  if (underscore.sites.length) {
    out =
      '/* v23:this-underscore ' +
      JSON.stringify(
        underscore.sites.map((s) => ({
          name: s.name,
          kind: s.kind,
          line: s.loc && s.loc.line,
        }))
      ) +
      ' */\n' +
      out
  }
  // Bridged $el / bare $refs / $parent / $root / $options — no AI-TODO (deterministic proxy).
  if (specialUsage.children) {
    out =
      '/* AI-TODO: [options-to-composition] this.$children removed in Vue3 — use template refs or provide/inject */\n' +
      out
  }
  if (specialUsage.destroy) {
    out =
      '/* AI-TODO: [options-to-composition] this.$destroy to app.unmount() is root-oriented; child self-destroy prefer v-if */\n' +
      out
  }
  if (specialUsage.optionsGone.size) {
    const keys = Array.from(specialUsage.optionsGone)
    changes.push({ kind: 'ai-options-gone', keys })
    out =
      '/* AI-TODO: [options-to-composition] this.$options.' +
      keys.join('/') +
      ' is undefined in script setup — reference the local binding instead */\n' +
      out
  }
  if (flat.modelNode) {
    out =
      '/* AI-TODO: [options-to-composition] options.model — map prop/event to modelValue / update:modelValue */\n' +
      out
  }
  if (changes.some((c) => c.kind === 'provide-ai')) {
    out =
      '/* AI-TODO: [options-to-composition] complex provide() — migrate provide/inject manually */\n' +
      out
  }
  const primitiveProvideKeys = changes
    .filter((c) => c.kind === 'provide-primitive-ref')
    .map((c) => c.name)
  if (primitiveProvideKeys.length) {
    out =
      '/* AI-TODO: [provide-primitive] keys [' +
      primitiveProvideKeys.join(', ') +
      '] wrapped in ref(); inject side must read Ref (.value) — Vue2 inject got the raw primitive */\n' +
      out
    changes.push({
      kind: 'ai-provide-primitive-inject',
      names: primitiveProvideKeys,
      note: 'partial: provide wrapped; verify inject callers',
    })
  }
  const dataUnderscoreAccessed = (underscore.sites || [])
    .filter((s) => s.kind === 'custom-or-unknown' && dataNames.has(s.name))
    .map((s) => s.name)
  const dataUnderscoreUnique = Array.from(new Set(dataUnderscoreAccessed))
  if (dataUnderscoreUnique.length) {
    out =
      '/* AI-TODO: [options-to-composition] data keys [' +
      dataUnderscoreUnique.join(', ') +
      '] used as this._xxx were NOT instance-proxied in Vue2; now bound to refs like other data — confirm callers */\n' +
      out
    changes.push({ kind: 'ai-data-underscore', names: dataUnderscoreUnique })
  }
  if (/\$children\b/.test(codeStr)) {
    out =
      '/* AI-TODO: [instance-api] this.$children removed in Vue3 — use template refs or provide/inject */\n' +
      out
  }

  out = '/* v23:composition */\n' + out
  changes.push({ kind: 'options-to-composition', members: returnEntries.length })

  return {
    code: out,
    changes,
    rebinding,
    underscore,
    filterRenames: flat.filterRenames || Object.create(null),
  }
}

module.exports = {
  migrateOptionsToComposition,
  analyzeThisRebinding,
  analyzeThisUnderscore,
  flattenMixins,
}

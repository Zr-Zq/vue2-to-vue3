/**
 * Vue.extend / Sub.extend to __v23Extend (constructable defineComponent).
 * - Vue.extend(opts) to __v23Extend(opts)
 * - Base.extend(opts) to __v23Extend({ extends: Base, ...opts })
 * - new SomeExtend() / const Ctor = SomeExtend; new Ctor() to __v23New(...)
 *   Same file and (via importedExtendNames) imported factories.
 * The helper stays a function so a dynamic `new variable()` and
 * `typeof Ctor === 'function'` keep the Vue2 meaning. Plain defineComponent()
 * is an object and breaks `new`.
 */

const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

const COMPAT_SPEC = '@/compat/v23-extend'

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

function withoutComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

/** Drop `import Vue` once Vue.extend / Vue.use / new Vue are gone. Vue 3 has no default export. */
function dropUnusedVueDefault(code) {
  const plain = withoutComments(code)
  if (/\bVue\s*\./.test(plain)) return code
  if (/\bnew\s+Vue\b/.test(plain)) return code
  let out = code.replace(
    /import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s+(['"]vue['"])/g,
    (m, inner, spec) => 'import { ' + inner.trim() + ' } from ' + spec
  )
  out = out.replace(/^[ \t]*import\s+Vue\s+from\s+['"]vue['"]\s*;?[ \t]*\r?\n?/m, '')
  return out
}

function compatNamesIn(code) {
  const names = []
  if (/\b__v23Extend\b/.test(code)) names.push('__v23Extend')
  if (/\b__v23New\b/.test(code)) names.push('__v23New')
  return names
}

function ensureCompatImport(code, options) {
  const dropVue = !!(options && options.dropVue)
  const names = compatNamesIn(code)
  if (!names.length) return { code, added: false }
  let out = dropVue ? dropUnusedVueDefault(code) : code
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"]@\/compat\/v23-extend['"])/
  if (re.test(out)) {
    const next = out.replace(re, (m, inner, spec) => {
      const have = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      names.forEach((n) => {
        if (have.indexOf(n) === -1) have.push(n)
      })
      return 'import { ' + have.join(', ') + ' } from ' + spec
    })
    return { code: next, added: next !== code }
  }
  const line = "import { " + names.join(', ') + " } from '" + COMPAT_SPEC + "'\n"
  const m = out.match(/^[ \t]*import\s/m)
  if (m) {
    const idx = out.indexOf(m[0])
    return { code: out.slice(0, idx) + line + out.slice(idx), added: true }
  }
  return { code: line + out, added: true }
}

/**
 * Split `{ a: 1, b: 2 }` object literal into "empty-or-not / insert extends"
 */
function injectExtends(objLiteral, baseName) {
  const body = objLiteral.replace(/^\{/, '').replace(/\}$/, '')
  const trimmed = body.trim()
  if (!trimmed) return '{ extends: ' + baseName + ' }'
  return '{ extends: ' + baseName + ', ' + trimmed + ' }'
}

function parseModule(code, filename) {
  return parser.parse(String(code || ''), {
    sourceType: 'unambiguous',
    sourceFilename: filename || 'anon.js',
    plugins: BABEL_PLUGINS,
    errorRecovery: false,
  })
}

function unwrapCallee(node) {
  let n = node
  while (
    n &&
    (t.isParenthesizedExpression(n) ||
      t.isTSAsExpression(n) ||
      t.isTSTypeAssertion(n) ||
      t.isTSNonNullExpression(n) ||
      t.isTSSatisfiesExpression(n))
  ) {
    n = n.expression
  }
  return n
}

function isExtendCall(node) {
  const n = unwrapCallee(node)
  if (!t.isCallExpression(n)) return false
  const c = n.callee
  if (t.isIdentifier(c) && c.name === '__v23Extend') return true
  if (
    t.isMemberExpression(c) &&
    !c.computed &&
    t.isIdentifier(c.object) &&
    t.isIdentifier(c.property) &&
    c.property.name === 'extend'
  ) {
    return true
  }
  return false
}

function nameOf(node) {
  if (!node) return null
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node)) return node.value
  return null
}

function markExtendBindings(ast, importedLocals) {
  const marked = new Set()
  const imported = importedLocals || new Set()
  let guard = 0
  let grown = true
  while (grown && guard < 12) {
    guard += 1
    const before = marked.size
    traverse(ast, {
      VariableDeclarator(p) {
        if (!t.isIdentifier(p.node.id) || !p.node.init) return
        const binding = p.scope.getBinding(p.node.id.name)
        if (!binding) return
        if (isExtendCall(p.node.init)) {
          marked.add(binding)
          return
        }
        const init = unwrapCallee(p.node.init)
        if (t.isIdentifier(init)) {
          const src = p.scope.getBinding(init.name)
          if (src && marked.has(src)) marked.add(binding)
        }
      },
      AssignmentExpression(p) {
        if (p.node.operator !== '=') return
        if (!t.isIdentifier(p.node.left)) return
        const right = unwrapCallee(p.node.right)
        if (!t.isIdentifier(right)) return
        const dst = p.scope.getBinding(p.node.left.name)
        const src = p.scope.getBinding(right.name)
        if (dst && src && marked.has(src)) marked.add(dst)
      },
      ImportSpecifier(p) {
        if (p.node.importKind === 'type') return
        const local = p.node.local && p.node.local.name
        if (!local || !imported.has(local)) return
        const binding = p.scope.getBinding(local)
        if (binding) marked.add(binding)
      },
      ImportDefaultSpecifier(p) {
        const local = p.node.local && p.node.local.name
        if (!local || !imported.has(local)) return
        const binding = p.scope.getBinding(local)
        if (binding) marked.add(binding)
      },
    })
    grown = marked.size !== before
  }
  return marked
}

/**
 * Rewrite `new Bound()` where Bound is an extend factory (local or imported).
 * @param {string} code
 * @param {string[]|Set<string>} importedExtendNames local names of imported factories
 */
function applyExtendNew(code, importedExtendNames) {
  const src = String(code || '')
  const imported = new Set(importedExtendNames || [])
  let ast
  try {
    ast = parseModule(src)
  } catch (e) {
    return { code: src, changes: [], parseError: e.message }
  }
  const marked = markExtendBindings(ast, imported)
  const reps = []
  traverse(ast, {
    NewExpression(p) {
      const callee = unwrapCallee(p.node.callee)
      if (!t.isIdentifier(callee)) return
      const binding = p.scope.getBinding(callee.name)
      if (!binding || !marked.has(binding)) return
      if (p.node.arguments.some((a) => t.isSpreadElement(a))) return
      if (p.node.arguments.length > 1) return
      const name = callee.name
      let text
      if (p.node.arguments.length === 0) {
        text = '__v23New(' + name + ')'
      } else {
        const arg = p.node.arguments[0]
        text = '__v23New(' + name + ', ' + src.slice(arg.start, arg.end) + ')'
      }
      reps.push({
        start: p.node.start,
        end: p.node.end,
        text,
        name,
      })
    },
  })
  if (!reps.length) return { code: src, changes: [] }
  reps.sort((a, b) => b.start - a.start)
  let out = src
  const changes = []
  reps.forEach((r) => {
    out = out.slice(0, r.start) + r.text + out.slice(r.end)
    changes.push({ kind: 'extend-new', from: 'new ' + r.name, to: '__v23New(' + r.name })
  })
  return { code: out, changes }
}

/**
 * Exports that are extend factories. `reexports` are not resolved here.
 */
function analyzeExtendModule(code) {
  let ast
  try {
    ast = parseModule(code)
  } catch (e) {
    return { named: [], hasDefault: false, reexports: [], parseError: e.message }
  }
  const marked = markExtendBindings(ast, new Set())
  const named = []
  let hasDefault = false
  const reexports = []
  traverse(ast, {
    ExportNamedDeclaration(p) {
      const node = p.node
      if (node.source && node.source.value) {
        ;(node.specifiers || []).forEach((spec) => {
          if (!t.isExportSpecifier(spec)) return
          reexports.push({
            source: node.source.value,
            imported: nameOf(spec.local),
            exported: nameOf(spec.exported),
          })
        })
        return
      }
      if (node.declaration && t.isVariableDeclaration(node.declaration)) {
        node.declaration.declarations.forEach((d) => {
          if (!t.isIdentifier(d.id)) return
          const b = p.scope.getBinding(d.id.name)
          if (b && marked.has(b)) named.push(d.id.name)
        })
      }
      ;(node.specifiers || []).forEach((spec) => {
        if (!t.isExportSpecifier(spec)) return
        const local = nameOf(spec.local)
        const exported = nameOf(spec.exported)
        const b = local ? p.scope.getBinding(local) : null
        if (!(b && marked.has(b))) return
        if (exported === 'default') hasDefault = true
        else if (exported) named.push(exported)
      })
    },
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration
      if (isExtendCall(d)) {
        hasDefault = true
        return
      }
      if (t.isIdentifier(d)) {
        const b = p.scope.getBinding(d.name)
        if (b && marked.has(b)) hasDefault = true
      }
    },
  })
  return { named, hasDefault, reexports }
}

function migrateExtend(code, options) {
  const changes = []
  let out = String(code || '')
  const beforeFactory = out

  // Vue.extend({ ... })
  out = out.replace(/Vue\.extend\s*\(\s*(\{[\s\S]*?\})\s*\)/g, (full, obj) => {
    const to = '__v23Extend(' + obj + ')'
    changes.push({ kind: 'vue-extend', from: 'Vue.extend(', to: '__v23Extend(' })
    return to
  })

  // Base.extend({ ... }) — identifier other than Vue.
  out = out.replace(
    /\b([A-Za-z_$][\w$]*)\.extend\s*\(\s*(\{[\s\S]*?\})\s*\)/g,
    (full, base, obj) => {
      if (base === 'Vue' || base === '__v23Extend') return full
      const to = '__v23Extend(' + injectExtends(obj, base) + ')'
      changes.push({
        kind: 'sub-extend',
        from: base + '.extend(',
        to: '__v23Extend({ extends: ' + base,
      })
      return to
    }
  )

  const factoryChanged = out !== beforeFactory
  const imported =
    options && options.importedExtendNames ? options.importedExtendNames : []
  const neu = applyExtendNew(out, imported)
  if (neu.code !== out) {
    out = neu.code
    changes.push(...neu.changes)
  }

  if (!changes.length) return { code, changes }

  const imp = ensureCompatImport(out, { dropVue: factoryChanged })
  out = imp.code
  if (imp.added) changes.push({ kind: 'import-v23-extend' })
  return { code: out, changes }
}

module.exports = {
  migrateExtend,
  applyExtendNew,
  analyzeExtendModule,
  ensureCompatImport,
  injectExtends,
  parseModule,
}

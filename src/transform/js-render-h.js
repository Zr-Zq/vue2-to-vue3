/**
 * render(h) → Vue3：
 * - 去掉 render 的 h 参数
 * - 补 import { h } from 'vue'
 * - this.$scopedSlots → this.$slots
 *
 * 另：h() 第二参里的 attrs/on/domProps 尽量拍平（常见子集）
 */
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

function hasHImport(ast) {
  let hit = false
  traverse(ast, {
    ImportDeclaration(p) {
      if (p.node.source.value !== 'vue' && p.node.source.value !== 'vue/dist/vue.esm.js') return
      p.node.specifiers.forEach((s) => {
        if (t.isImportSpecifier(s) && t.isIdentifier(s.imported, { name: 'h' })) hit = true
        if (t.isImportDefaultSpecifier(s) && s.local.name === 'h') hit = true
      })
    },
  })
  return hit
}

function ensureHImport(code, ast) {
  if (hasHImport(ast)) return { code, added: false }
  // 已有 import Vue from 'vue' 时追加 { h }
  const vueImport = /import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s*['"]vue['"]/
  const vueImportNamed = /import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/
  const vueDefault = /import\s+Vue\s+from\s*['"]vue['"]/

  if (vueImport.test(code)) {
    return {
      code: code.replace(vueImport, (m, inner) => {
        if (/\bh\b/.test(inner)) return m
        return 'import Vue, { h, ' + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (vueImportNamed.test(code)) {
    return {
      code: code.replace(vueImportNamed, (m, inner) => {
        if (/\bh\b/.test(inner)) return m
        return 'import { h, ' + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (vueDefault.test(code)) {
    return {
      code: code.replace(vueDefault, "import Vue, { h } from 'vue'"),
      added: true,
    }
  }
  // 插到首个 import 前或文件头
  const m = code.match(/^(\s*)import\s/m)
  if (m) {
    const idx = code.indexOf(m[0])
    return {
      code: code.slice(0, idx) + "import { h } from 'vue'\n" + code.slice(idx),
      added: true,
    }
  }
  return { code: "import { h } from 'vue'\n" + code, added: true }
}

function isHParam(param) {
  return t.isIdentifier(param, { name: 'h' })
}

function stripHParam(fnNode) {
  if (!fnNode || !fnNode.params || !fnNode.params.length) return false
  if (!isHParam(fnNode.params[0])) return false
  fnNode.params = fnNode.params.slice(1)
  return true
}

/**
 * 拍平 h 第二参：{ attrs, on, domProps, props, class, style, key, ref, ... }
 * → Vue3 扁平对象（常见子集；复杂嵌套仍保留）
 */
function flattenHDataObject(objExpr) {
  if (!t.isObjectExpression(objExpr)) return null
  const props = objExpr.properties
  const bags = { attrs: null, on: null, nativeOn: null, domProps: null, props: null }
  const rest = []
  let changed = false
  let staticClass = null
  let staticStyle = null

  props.forEach((p) => {
    if (!t.isObjectProperty(p) || p.computed) {
      rest.push(p)
      return
    }
    const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null
    if (key === 'staticClass') {
      staticClass = p.value
      changed = true
      return
    }
    if (key === 'staticStyle') {
      staticStyle = p.value
      changed = true
      return
    }
    if (key && Object.prototype.hasOwnProperty.call(bags, key) && bags[key] === null && t.isObjectExpression(p.value)) {
      bags[key] = p.value
      changed = true
    } else {
      rest.push(p)
    }
  })
  if (!changed) return null

  const nextProps = rest.slice()

  if (staticClass) {
    // 与已有 class 合并较难；无 class 时直接 class: staticClass
    const hasClass = nextProps.some(
      (p) =>
        t.isObjectProperty(p) &&
        ((t.isIdentifier(p.key) && p.key.name === 'class') ||
          (t.isStringLiteral(p.key) && p.key.value === 'class'))
    )
    if (!hasClass) nextProps.push(t.objectProperty(t.identifier('class'), staticClass))
    else nextProps.push(t.objectProperty(t.identifier('class'), staticClass)) // 简化：后写覆盖/并存由运行时处理
  }
  if (staticStyle) {
    nextProps.push(t.objectProperty(t.identifier('style'), staticStyle))
  }

  ;['props', 'attrs', 'domProps'].forEach((bag) => {
    if (!bags[bag]) return
    bags[bag].properties.forEach((p) => nextProps.push(p))
  })

  function mapOnBag(bag) {
    if (!bag) return
    bag.properties.forEach((p) => {
      if (!t.isObjectProperty(p) || p.computed) {
        nextProps.push(p)
        return
      }
      const ev = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null
      if (!ev) {
        nextProps.push(p)
        return
      }
      const onName = 'on' + ev.charAt(0).toUpperCase() + ev.slice(1)
      if (/^[A-Za-z_$][\w$]*$/.test(onName)) {
        nextProps.push(t.objectProperty(t.identifier(onName), p.value))
      } else {
        nextProps.push(t.objectProperty(t.stringLiteral(onName), p.value))
      }
    })
  }
  mapOnBag(bags.on)
  mapOnBag(bags.nativeOn) // Vue3 无 .native，打平到 onXxx
  return t.objectExpression(nextProps)
}

/**
 * @returns {{ code: string, changes: object[] }}
 */
function migrateRenderH(code, filename) {
  const changes = []
  let ast
  try {
    ast = parseJs(code, filename || 'render.js')
  } catch (e) {
    return { code, changes, error: e.message }
  }

  let stripped = 0
  let scopedSlots = 0
  let flattened = 0

  traverse(ast, {
    ObjectMethod(p) {
      if (!t.isIdentifier(p.node.key, { name: 'render' })) return
      if (stripHParam(p.node)) {
        stripped += 1
        changes.push({ kind: 'render-strip-h', loc: p.node.key.loc && p.node.key.loc.start })
      }
    },
    ObjectProperty(p) {
      if (!t.isIdentifier(p.node.key, { name: 'render' })) return
      const v = p.node.value
      if (t.isFunctionExpression(v) || t.isArrowFunctionExpression(v)) {
        if (stripHParam(v)) {
          stripped += 1
          changes.push({ kind: 'render-strip-h', loc: p.node.key.loc && p.node.key.loc.start })
        }
      }
    },
    // export default { render(h) {} } already covered by ObjectMethod
    // function render(h) at top-level rare
    MemberExpression(p) {
      // this.$scopedSlots → this.$slots
      if (
        t.isThisExpression(p.node.object) &&
        t.isIdentifier(p.node.property, { name: '$scopedSlots' }) &&
        !p.node.computed
      ) {
        p.node.property.name = '$slots'
        scopedSlots += 1
        changes.push({ kind: 'scopedSlots-to-slots' })
      }
    },
    CallExpression(p) {
      // h('div', { attrs/on/... }, children)
      if (!t.isIdentifier(p.node.callee, { name: 'h' })) return
      if (p.node.arguments.length < 2) return
      const dataArg = p.node.arguments[1]
      const flat = flattenHDataObject(dataArg)
      if (flat) {
        p.node.arguments[1] = flat
        flattened += 1
        changes.push({ kind: 'h-data-flatten' })
      }
    },
  })

  if (!stripped && !scopedSlots && !flattened) {
    // 仍清理注释里的旧 API 文案，避免误导
    const cleaned = code.replace(/this\.\$scopedSlots\b/g, 'this.$slots')
    if (cleaned !== code) {
      return {
        code: cleaned,
        changes: [{ kind: 'scopedSlots-in-comments' }],
        stats: { stripped, scopedSlots, flattened },
      }
    }
    return { code, changes }
  }

  // 用 @babel/generator 更稳；若无依赖则手工难以还原。检查是否有 generator。
  let generate
  try {
    generate = require('@babel/generator').default
  } catch (e) {
    generate = null
  }

  let nextCode = code
  if (generate) {
    nextCode = generate(ast, { retainLines: true, compact: false, comments: true }, code).code
  } else {
    // 无 generator：仅做文本级 strip render(h) / $scopedSlots（不拍平 h data）
    nextCode = code
      .replace(/\brender\s*\(\s*h\s*\)\s*\{/g, 'render() {')
      .replace(/\brender\s*:\s*\(\s*h\s*\)\s*=>/g, 'render: () =>')
      .replace(/\brender\s*:\s*function\s*\(\s*h\s*\)\s*\{/g, 'render: function() {')
      .replace(/this\.\$scopedSlots\b/g, 'this.$slots')
    changes.push({ kind: 'render-text-fallback', note: 'no @babel/generator' })
  }

  // 注释里的 this.$scopedSlots 一并替换（generator 会保留原注释文本）
  if (/this\.\$scopedSlots\b/.test(nextCode)) {
    nextCode = nextCode.replace(/this\.\$scopedSlots\b/g, 'this.$slots')
    changes.push({ kind: 'scopedSlots-in-comments' })
  }

  // 只有去掉了 h 参数（或代码里仍在调用 h(）时才补 import
  const needsH =
    stripped > 0 ||
    (flattened > 0 && /\bh\s*\(/.test(nextCode)) ||
    (/\brender\s*\(\s*\)/.test(nextCode) && /\bh\s*\(/.test(nextCode))
  if (needsH) {
    const withImport = ensureHImport(nextCode, ast)
    if (withImport.added) {
      nextCode = withImport.code
      changes.push({ kind: 'import-h' })
    }
  }

  return {
    code: nextCode,
    changes,
    stats: { stripped, scopedSlots, flattened },
  }
}

module.exports = {
  migrateRenderH,
  ensureHImport,
  flattenHDataObject,
}

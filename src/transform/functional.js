/**
 * Vue2 functional → Vue3 普通组件（官方迁移路径）
 * @see https://v3-migration.vuejs.org/breaking-changes/functional-components.html
 *
 * SFC：
 * - <template functional> → <template>
 * - props.x → $props.x；attrs / data.attrs → $attrs
 * - v-on="listeners" 删除（listeners 已并入 $attrs）
 * - data.staticClass / data.class / data.style → $attrs 对应字段或删除
 * - functional: true 删除
 *
 * JS：
 * - { functional: true, render(h, ctx) } → 普通 render / 或保留 render 去第二参上下文（见下）
 */

const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

/**
 * 改写 functional 模板正文（不含 <template> 标签本身）
 */
function rewriteFunctionalTemplateBody(code) {
  const changes = []
  let out = String(code || '')

  // v-on="listeners" / v-on='listeners' → 删除（$attrs 已含事件）
  out = out.replace(/\s+v-on\s*=\s*(["'])listeners\1/g, () => {
    changes.push({ kind: 'fn-drop-listeners' })
    return ''
  })
  // v-on="data.on"
  out = out.replace(/\s+v-on\s*=\s*(["'])data\.on\1/g, () => {
    changes.push({ kind: 'fn-drop-data-on' })
    return ''
  })

  // v-bind="data.attrs" / v-bind="attrs" → v-bind="$attrs"
  out = out.replace(/\bv-bind\s*=\s*(["'])data\.attrs\1/g, (m, q) => {
    changes.push({ kind: 'fn-data-attrs' })
    return 'v-bind=' + q + '$attrs' + q
  })
  out = out.replace(/\bv-bind\s*=\s*(["'])attrs\1/g, (m, q) => {
    changes.push({ kind: 'fn-attrs' })
    return 'v-bind=' + q + '$attrs' + q
  })

  // :class="data.staticClass" / data.class → 可并入 $attrs；单根透传时常删
  out = out.replace(/\s+:class\s*=\s*(["'])data\.staticClass\1/g, () => {
    changes.push({ kind: 'fn-drop-staticClass' })
    return ''
  })
  out = out.replace(/\s+:class\s*=\s*(["'])data\.class\1/g, (m, q) => {
    changes.push({ kind: 'fn-data-class' })
    return ' :class=' + q + '$attrs.class' + q
  })
  out = out.replace(/\s+:style\s*=\s*(["'])data\.style\1/g, (m, q) => {
    changes.push({ kind: 'fn-data-style' })
    return ' :style=' + q + '$attrs.style' + q
  })

  // props.xxx / props['x'] → $props.xxx（避免已是 $props）
  out = out.replace(/(^|[^$])\bprops\./g, (m, lead) => {
    changes.push({ kind: 'fn-props-dot' })
    return lead + '$props.'
  })
  out = out.replace(/(^|[^$])\bprops\[/g, (m, lead) => {
    changes.push({ kind: 'fn-props-idx' })
    return lead + '$props['
  })

  // 插值/表达式里的裸 attrs. / listeners.（少见）
  out = out.replace(/(^|[^$])\battrs\./g, (m, lead) => {
    changes.push({ kind: 'fn-attrs-dot' })
    return lead + '$attrs.'
  })

  // slots.default → $slots.default（模板里）
  out = out.replace(/(^|[^$])\bslots\./g, (m, lead) => {
    changes.push({ kind: 'fn-slots' })
    return lead + '$slots.'
  })
  out = out.replace(/(^|[^$])\bscopedSlots\./g, (m, lead) => {
    changes.push({ kind: 'fn-scopedSlots' })
    return lead + '$slots.'
  })

  return { code: out, changes }
}

/**
 * 整文件：去掉真正的 SFC 开标签 <template functional>
 * （不碰注释/字符串里的同名片段）
 */
function stripTemplateFunctionalAttr(vueSource) {
  const changes = []
  const out = String(vueSource || '').replace(
    /^[ \t]*<template(\s[^>]*)?\bfunctional\b([^>]*)>/gim,
    (full, pre, post) => {
      changes.push({ kind: 'fn-strip-template-attr' })
      const mid = (String(pre || '') + String(post || '')).replace(/\s+/g, ' ').trim()
      const lead = full.match(/^[ \t]*/)[0] || ''
      return lead + (mid ? '<template ' + mid + '>' : '<template>')
    }
  )
  return { code: out, changes }
}

function removeFunctionalOption(code, filename) {
  const changes = []
  let ast
  try {
    ast = parseJs(code, filename || 'fn.js')
  } catch (e) {
    const text = String(code || '').replace(/\bfunctional\s*:\s*true\s*,?/g, (m) => {
      changes.push({ kind: 'fn-option-text' })
      return ''
    })
    return { code: text, changes }
  }

  traverse(ast, {
    ObjectProperty(p) {
      if (
        (t.isIdentifier(p.node.key, { name: 'functional' }) ||
          (t.isStringLiteral(p.node.key) && p.node.key.value === 'functional')) &&
        t.isBooleanLiteral(p.node.value, { value: true })
      ) {
        p.remove()
        changes.push({ kind: 'fn-option-remove' })
      }
    },
  })

  // render(h, ctx) 且曾是 functional：把第二参解构映射到 this/$attrs（尽力）
  traverse(ast, {
    ObjectMethod(p) {
      if (!t.isIdentifier(p.node.key, { name: 'render' })) return
      if (p.node.params.length < 2) return
      rewriteFunctionalRenderMethod(p, changes)
    },
    ObjectProperty(p) {
      if (!t.isIdentifier(p.node.key, { name: 'render' })) return
      const fn = p.node.value
      if (!t.isFunctionExpression(fn) && !t.isArrowFunctionExpression(fn)) return
      if (fn.params.length < 2) return
      // 包成 ObjectMethod 风格处理：改 params + 注入声明
      const fake = { node: { key: p.node.key, params: fn.params, body: fn.body }, replaceWith() {} }
      // 直接改 fn
      rewriteFunctionalRenderFn(fn, changes)
    },
  })

  if (!changes.length) return { code, changes }
  const gen = generate(ast, { retainLines: true, compact: false, comments: true }, code)
  return { code: gen.code, changes }
}

function rewriteFunctionalRenderMethod(path, changes) {
  const node = path.node
  rewriteFunctionalRenderFn(node, changes)
}

function rewriteFunctionalRenderFn(fnNode, changes) {
  // render(h, { props, data, children, listeners, scopedSlots, injections }) 
  // → render() { const props = this.$props; const data = { attrs: this.$attrs }; ... }
  // 简化：去掉第二参，在函数体前插入 const 绑定
  const ctxParam = fnNode.params[1]
  fnNode.params = fnNode.params.slice(0, 1) // 保留 h，后续 migrate-render-h 再去

  const decls = []
  function addConst(name, init) {
    decls.push(
      t.variableDeclaration('const', [t.variableDeclarator(t.identifier(name), init)])
    )
  }

  if (t.isObjectPattern(ctxParam)) {
    ctxParam.properties.forEach((prop) => {
      if (!t.isObjectProperty(prop) && !t.isRestElement(prop)) return
      if (t.isRestElement(prop)) return
      const key = t.isIdentifier(prop.key) ? prop.key.name : null
      const local = t.isIdentifier(prop.value)
        ? prop.value.name
        : t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)
          ? prop.value.left.name
          : key
      if (!key || !local) return
      if (key === 'props') {
        addConst(local, t.memberExpression(t.thisExpression(), t.identifier('$props')))
      } else if (key === 'listeners' || key === 'attrs') {
        addConst(local, t.memberExpression(t.thisExpression(), t.identifier('$attrs')))
      } else if (key === 'data') {
        // data ≈ { attrs: $attrs } 近似
        addConst(
          local,
          t.objectExpression([
            t.objectProperty(
              t.identifier('attrs'),
              t.memberExpression(t.thisExpression(), t.identifier('$attrs'))
            ),
          ])
        )
      } else if (key === 'children') {
        addConst(
          local,
          t.memberExpression(
            t.memberExpression(t.thisExpression(), t.identifier('$slots')),
            t.identifier('default')
          )
        )
      } else if (key === 'scopedSlots' || key === 'slots') {
        addConst(local, t.memberExpression(t.thisExpression(), t.identifier('$slots')))
      } else if (key === 'injections') {
        // 无法静态还原 inject，留空对象并记 change
        addConst(local, t.objectExpression([]))
        changes.push({ kind: 'fn-render-injections-empty' })
      }
    })
  } else if (t.isIdentifier(ctxParam)) {
    const id = ctxParam.name
    addConst(
      id,
      t.objectExpression([
        t.objectProperty(
          t.identifier('props'),
          t.memberExpression(t.thisExpression(), t.identifier('$props'))
        ),
        t.objectProperty(
          t.identifier('attrs'),
          t.memberExpression(t.thisExpression(), t.identifier('$attrs'))
        ),
        t.objectProperty(
          t.identifier('slots'),
          t.memberExpression(t.thisExpression(), t.identifier('$slots'))
        ),
      ])
    )
  }

  if (decls.length && t.isBlockStatement(fnNode.body)) {
    fnNode.body.body = decls.concat(fnNode.body.body)
    changes.push({ kind: 'fn-render-ctx-to-this' })
  } else if (decls.length && t.isExpression(fnNode.body)) {
    fnNode.body = t.blockStatement(decls.concat([t.returnStatement(fnNode.body)]))
    changes.push({ kind: 'fn-render-ctx-to-this' })
  }
}

/**
 * 检测改写后是否仍残留难以脚本处理的 functional 上下文
 */
function residualFunctionalContext(code) {
  const c = String(code || '')
  const hits = []
  if (/\binjections\b/.test(c)) hits.push('injections')
  if (/<template[^>]*\bfunctional\b/i.test(c)) hits.push('template-functional')
  if (/\bfunctional\s*:\s*true\b/.test(c)) hits.push('option-functional')
  return hits
}

/**
 * 迁移整份 .vue 或 .js
 * @returns {{ code: string, changes: object[], residual: string[] }}
 */
function migrateFunctional(code, filename) {
  const changes = []
  let out = String(code || '')
  const isVue = /\.vue$/i.test(filename || '') || /<template[\s>]/i.test(out)

  if (isVue) {
    const strip = stripTemplateFunctionalAttr(out)
    out = strip.code
    changes.push(...strip.changes)

    // 对 template 块内容做上下文改写（用简单切分；精确写回由插件 applySfcTransforms）
    out = out.replace(
      /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/gi,
      (full, open, body, close) => {
        // 仅当本文件曾是 functional 或 body 含 props./listeners/data.attrs
        if (
          !strip.changes.length &&
          !/\bprops\.|\blisteners\b|\bdata\.attrs\b|\bscopedSlots\b/.test(body)
        ) {
          return full
        }
        // 若从未 strip 且也无线索，跳过；若 strip 过或有线索则改
        if (
          strip.changes.length ||
          /\bprops\.|\bv-on\s*=\s*["']listeners["']|\bdata\.attrs\b|\battrs\b/.test(body)
        ) {
          const r = rewriteFunctionalTemplateBody(body)
          changes.push(...r.changes)
          return open + r.code + close
        }
        return full
      }
    )
  }

  const jsPart = removeFunctionalOption(out, filename)
  // removeFunctionalOption 对整文件 parse 在 .vue 上会失败 → text fallback
  if (jsPart.changes.length) {
    out = jsPart.code
    changes.push(...jsPart.changes)
  } else if (isVue) {
    // 只在 script 内去 functional: true
    out = out.replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (full, open, body, close) => {
        const r = removeFunctionalOption(body, filename + '#script')
        if (!r.changes.length) return full
        changes.push(...r.changes)
        return open + r.code + close
      }
    )
  }

  return {
    code: out,
    changes,
    residual: residualFunctionalContext(out),
  }
}

/**
 * 供 applySfcTransforms：只改 template body
 */
function migrateFunctionalTemplate(code) {
  return rewriteFunctionalTemplateBody(code)
}

/**
 * 供 applySfcTransforms：只改 script
 */
function migrateFunctionalScript(code, filename) {
  return removeFunctionalOption(code, filename)
}

module.exports = {
  rewriteFunctionalTemplateBody,
  stripTemplateFunctionalAttr,
  removeFunctionalOption,
  migrateFunctional,
  migrateFunctionalTemplate,
  migrateFunctionalScript,
  residualFunctionalContext,
}

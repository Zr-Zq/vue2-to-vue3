/**
 * Vue2 functional to Vue3 normal component (official migration path)
 * @see https://v3-migration.vuejs.org/breaking-changes/functional-components.html
 *
 * SFC:
 * - <template functional> to <template>
 * - props.x to $props.x; attrs / data.attrs to $attrs
 * - Remove v-on="listeners" (listeners merged into $attrs)
 * - data.staticClass / data.class / data.style to matching $attrs fields or remove
 * - Remove functional: true
 *
 * JS:
 * - { functional: true, render(h, ctx) } to normal render / or keep render and drop 2nd-arg context (below)
 */

const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { parseJs } = require('../parse-file')

/**
 * Rewrite functional template body (not the <template> tag itself)
 */
function rewriteFunctionalTemplateBody(code) {
  const changes = []
  let out = String(code || '')

  // v-on="listeners" / v-on='listeners' to remove ($attrs already includes events)
  out = out.replace(/\s+v-on\s*=\s*(["'])listeners\1/g, () => {
    changes.push({ kind: 'fn-drop-listeners' })
    return ''
  })
  // v-on="data.on"
  out = out.replace(/\s+v-on\s*=\s*(["'])data\.on\1/g, () => {
    changes.push({ kind: 'fn-drop-data-on' })
    return ''
  })

  // v-bind="data.attrs" / v-bind="attrs" to v-bind="$attrs"
  out = out.replace(/\bv-bind\s*=\s*(["'])data\.attrs\1/g, (m, q) => {
    changes.push({ kind: 'fn-data-attrs' })
    return 'v-bind=' + q + '$attrs' + q
  })
  out = out.replace(/\bv-bind\s*=\s*(["'])attrs\1/g, (m, q) => {
    changes.push({ kind: 'fn-attrs' })
    return 'v-bind=' + q + '$attrs' + q
  })

  // :class="data.staticClass" / data.class to can merge into $attrs; often removed with single-root fallthrough
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

  // props.xxx / props['x'] to $props.xxx (avoid if already $props)
  out = out.replace(/(^|[^$])\bprops\./g, (m, lead) => {
    changes.push({ kind: 'fn-props-dot' })
    return lead + '$props.'
  })
  out = out.replace(/(^|[^$])\bprops\[/g, (m, lead) => {
    changes.push({ kind: 'fn-props-idx' })
    return lead + '$props['
  })

  // Bare attrs. / listeners. in interpolations/expressions (rare)
  out = out.replace(/(^|[^$])\battrs\./g, (m, lead) => {
    changes.push({ kind: 'fn-attrs-dot' })
    return lead + '$attrs.'
  })

  // slots.default to $slots.default (in template)
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
 * Whole file: strip real SFC open tag <template functional>
 * (do not touch same text inside comments/strings)
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

  // render(h, ctx) that was functional: map 2nd-arg destructure to this/$attrs (best effort)
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
      // Treat as ObjectMethod style: change params + inject decls
      const fake = { node: { key: p.node.key, params: fn.params, body: fn.body }, replaceWith() {} }
      // Rewrite fn directly
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
  // to render() { const props = this.$props; const data = { attrs: this.$attrs }; ... }
  // Simplified: drop 2nd param; insert const bindings at function body start
  const ctxParam = fnNode.params[1]
  fnNode.params = fnNode.params.slice(0, 1) // keep h; migrate-render-h removes it later

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
        // data ≈ { attrs: $attrs } approximation
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
        // Cannot statically restore inject; leave empty object and record change
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
 * Detect remaining functional context that is hard to script-handle after rewrite
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
 * Migrate a whole .vue or .js file
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

    // Rewrite template block body context (simple split; precise write-back via applySfcTransforms plugin)
    out = out.replace(
      /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/gi,
      (full, open, body, close) => {
        // Only when file was functional or body contains props./listeners/data.attrs
        if (
          !strip.changes.length &&
          !/\bprops\.|\blisteners\b|\bdata\.attrs\b|\bscopedSlots\b/.test(body)
        ) {
          return full
        }
        // Skip if never stripped and no clues; rewrite if stripped or clues exist
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
  // removeFunctionalOption whole-file parse fails on .vue to text fallback
  if (jsPart.changes.length) {
    out = jsPart.code
    changes.push(...jsPart.changes)
  } else if (isVue) {
    // Only remove functional: true inside script
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
 * For applySfcTransforms: rewrite template body only
 */
function migrateFunctionalTemplate(code) {
  return rewriteFunctionalTemplateBody(code)
}

/**
 * For applySfcTransforms: rewrite script only
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

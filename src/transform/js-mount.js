/**
 * Deterministic mount-related rewrites:
 * - new Vue({...}).$mount(el) → createApp({...}).use(...).mount(el)
 * - new Vue({...}).$mount() → createApp({...}).mount(document.createElement('div'))
 * - new Ctor({ propsData }) → createApp(Ctor, props)
 * - vm.$mount(el) / vm.$mount() → .mount(...)
 */

function ensureCreateAppImport(code) {
  if (/import\s*\{[^}]*\bcreateApp\b[^}]*\}\s*from\s*['"]vue['"]/.test(code)) {
    return { code, added: false }
  }
  if (/import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(/import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s*['"]vue['"]/, (m, inner) => {
        if (/\bcreateApp\b/.test(inner)) return "import { " + inner.trim() + " } from 'vue'"
        return "import { createApp, " + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/, (m, inner) => {
        if (/\bcreateApp\b/.test(inner)) return m
        return 'import { createApp, ' + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (/import\s+Vue\s+from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(/import\s+Vue\s+from\s*['"]vue['"]/, "import { createApp } from 'vue'"),
      added: true,
    }
  }
  const m = code.match(/^(\s*)import\s/m)
  if (m) {
    const idx = code.indexOf(m[0])
    return {
      code: code.slice(0, idx) + "import { createApp } from 'vue'\n" + code.slice(idx),
      added: true,
    }
  }
  return { code: "import { createApp } from 'vue'\n" + code, added: true }
}

function extractPluginsFromOptions(optsSrc) {
  let body = optsSrc
  const uses = []
  ;['router', 'store'].forEach((name) => {
    const reShort = new RegExp('(^|[,\\n\\r])(\\s*)' + name + '\\s*(?=,|[\\n\\r]|})')
    const reLong = new RegExp('(^|[,\\n\\r])(\\s*)' + name + '\\s*:\\s*([^,\\n\\r}]+)')
    if (reLong.test(body)) {
      body = body.replace(reLong, (mm, lead, sp, val) => {
        uses.push(val.trim())
        return lead + sp
      })
    } else if (reShort.test(body)) {
      body = body.replace(reShort, (mm, lead, sp) => {
        uses.push(name)
        return lead + sp
      })
    }
  })
  body = body
    .replace(/,\s*,/g, ',')
    .replace(/\{\s*,/g, '{')
    .replace(/,\s*\}/g, '\n}')
  return { body, uses }
}

function buildCreateAppFromOptions(opts, elExpr) {
  const { body, uses } = extractPluginsFromOptions(opts)
  let expr = 'createApp(' + body + ')'
  uses.forEach((u) => {
    expr += '.use(' + u + ')'
  })
  expr += '.mount(' + elExpr + ')'
  return expr
}

function migrateMount(code) {
  const changes = []
  let out = String(code || '')

  // new Vue({...}).$mount(el)
  out = out.replace(
    /new\s+Vue\s*\(\s*(\{[\s\S]*?\})\s*\)\s*\.\s*\$mount\s*\(\s*([^)]+?)\s*\)/g,
    (full, opts, el) => {
      const expr = buildCreateAppFromOptions(opts, el.trim())
      changes.push({ kind: 'new-vue-mount', from: full.slice(0, 60), to: expr.slice(0, 60) })
      return expr
    }
  )

  // new Vue({...}).$mount()
  out = out.replace(
    /new\s+Vue\s*\(\s*(\{[\s\S]*?\})\s*\)\s*\.\s*\$mount\s*\(\s*\)/g,
    (full, opts) => {
      const expr = buildCreateAppFromOptions(opts, 'document.createElement("div")')
      changes.push({ kind: 'new-vue-mount-empty', from: full.slice(0, 60), to: expr.slice(0, 60) })
      return expr
    }
  )

  // new Vue(Ctor).$mount(el) / new Vue(Ctor).$mount()
  out = out.replace(
    /new\s+Vue\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*\$mount\s*\(\s*([^)]*)\s*\)/g,
    (full, ctor, el) => {
      const elExpr = String(el || '').trim() || 'document.createElement("div")'
      const to = 'createApp(' + ctor + ').mount(' + elExpr + ')'
      changes.push({ kind: 'new-vue-ctor-mount', from: full.slice(0, 60), to: to.slice(0, 60) })
      return to
    }
  )

  // new Vue(Ctor) → createApp(Ctor) (no immediate mount)
  out = out.replace(/new\s+Vue\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, (full, ctor) => {
    const to = 'createApp(' + ctor + ')'
    changes.push({ kind: 'new-vue-ctor', from: full, to })
    return to
  })

  // new Ctor({ propsData: { ... } }) → createApp(Ctor, { ... })
  out = out.replace(
    /new\s+([A-Za-z_$][\w$]*)\s*\(\s*\{\s*propsData\s*:\s*(\{[\s\S]*?\})\s*,?\s*\}\s*\)/g,
    (full, ctor, props) => {
      const to = 'createApp(' + ctor + ', ' + props + ')'
      changes.push({ kind: 'propsData-to-createApp', from: full.slice(0, 60), to: to.slice(0, 60) })
      return to
    }
  )

  // xxx.$mount('#sel')
  out = out.replace(
    /(\b[A-Za-z_$][\w$]*)\s*\.\s*\$mount\s*\(\s*(['"`][^'"`]+['"`])\s*\)/g,
    (full, id, el) => {
      const to = id + '.mount(' + el + ')'
      changes.push({ kind: 'dot-mount', from: full, to })
      return to
    }
  )

  // xxx.$mount() → xxx.mount(document.createElement('div'))
  out = out.replace(/(\b[A-Za-z_$][\w$]*)\s*\.\s*\$mount\s*\(\s*\)/g, (full, id) => {
    const to = id + '.mount(document.createElement("div"))'
    changes.push({ kind: 'dot-mount-empty', from: full, to })
    return to
  })

  // $destroy() → approx: skip if __v23App present; typical vm.$destroy() needs app handle for unmount
  // Deterministic: this._x.$destroy() often breaks after mount rewrite; comment no-op / drop call
  out = out.replace(/(\b[A-Za-z_$][\w$.]*)\s*\.\s*\$destroy\s*\(\s*\)/g, (full, id) => {
    // Vue3 component instance has no $destroy; if createApp proxy, keep app and unmount
    const to = '(' + id + '.$el && ' + id + '.$el.remove && ' + id + '.$el.remove())'
    changes.push({ kind: 'destroy-approx', from: full, to })
    return to
  })

  if (!changes.length) return { code, changes }

  const imp = ensureCreateAppImport(out)
  out = imp.code
  if (imp.added) changes.push({ kind: 'import-createApp' })
  return { code: out, changes }
}

module.exports = {
  migrateMount,
  ensureCreateAppImport,
  extractPluginsFromOptions,
}

/**
 * Vue.extend / Sub.extend → defineComponent
 * - Vue.extend(opts) → defineComponent(opts)
 * - Base.extend(opts) → defineComponent({ extends: Base, ...opts })
 */

function ensureDefineComponentImport(code) {
  if (/import\s*\{[^}]*\bdefineComponent\b[^}]*\}\s*from\s*['"]vue['"]/.test(code)) {
    return { code, added: false }
  }
  if (/import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(/import\s+Vue\s*,\s*\{([^}]*)\}\s*from\s*['"]vue['"]/, (m, inner) => {
        if (/\bdefineComponent\b/.test(inner)) return "import { " + inner.trim() + " } from 'vue'"
        return "import { defineComponent, " + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(/import\s*\{([^}]*)\}\s*from\s*['"]vue['"]/, (m, inner) => {
        if (/\bdefineComponent\b/.test(inner)) return m
        return 'import { defineComponent, ' + inner.trim() + " } from 'vue'"
      }),
      added: true,
    }
  }
  if (/import\s+Vue\s+from\s*['"]vue['"]/.test(code)) {
    return {
      code: code.replace(
        /import\s+Vue\s+from\s*['"]vue['"]/,
        "import { defineComponent } from 'vue'"
      ),
      added: true,
    }
  }
  const m = code.match(/^(\s*)import\s/m)
  if (m) {
    const idx = code.indexOf(m[0])
    return {
      code: code.slice(0, idx) + "import { defineComponent } from 'vue'\n" + code.slice(idx),
      added: true,
    }
  }
  return { code: "import { defineComponent } from 'vue'\n" + code, added: true }
}

/**
 * 把 `{ a: 1, b: 2 }` 对象字面量拆成「是否空 / 插入 extends」
 */
function injectExtends(objLiteral, baseName) {
  const body = objLiteral.replace(/^\{/, '').replace(/\}$/, '')
  const trimmed = body.trim()
  if (!trimmed) return '{ extends: ' + baseName + ' }'
  return '{ extends: ' + baseName + ', ' + trimmed + ' }'
}

function migrateExtend(code) {
  const changes = []
  let out = String(code || '')

  // Vue.extend({ ... })
  out = out.replace(/Vue\.extend\s*\(\s*(\{[\s\S]*?\})\s*\)/g, (full, obj) => {
    const to = 'defineComponent(' + obj + ')'
    changes.push({ kind: 'vue-extend', from: 'Vue.extend(', to: 'defineComponent(' })
    return to
  })

  // Base.extend({ ... }) — 非 Vue. 的标识符
  out = out.replace(
    /\b([A-Za-z_$][\w$]*)\.extend\s*\(\s*(\{[\s\S]*?\})\s*\)/g,
    (full, base, obj) => {
      if (base === 'Vue') return full
      const to = 'defineComponent(' + injectExtends(obj, base) + ')'
      changes.push({ kind: 'sub-extend', from: base + '.extend(', to: 'defineComponent({ extends: ' + base })
      return to
    }
  )

  if (!changes.length) return { code, changes }

  const imp = ensureDefineComponentImport(out)
  out = imp.code
  if (imp.added) changes.push({ kind: 'import-defineComponent' })
  return { code: out, changes }
}

module.exports = {
  migrateExtend,
  ensureDefineComponentImport,
  injectExtends,
}

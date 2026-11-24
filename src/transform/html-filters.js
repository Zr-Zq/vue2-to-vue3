/**
 * 模板过滤器 | → 函数调用（确定性）
 * {{ a | f }} → {{ f(a) }}
 * {{ a | f(x) | g }} → {{ g(f(a, x)) }}
 * :title="a | f" → :title="f(a)"
 *
 * 同时把 options.filters 合并进 methods（由 js-filters-option 负责）
 */

function splitPipes(expr) {
  const parts = []
  let cur = ''
  let depth = 0
  let quote = null
  const s = String(expr || '')
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (quote) {
      cur += ch
      if (ch === '\\' && i + 1 < s.length) {
        cur += s[i + 1]
        i += 1
      } else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
      cur += ch
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      cur += ch
      continue
    }
    if (ch === '|' && depth === 0) {
      // 避免 ||
      if (s[i + 1] === '|') {
        cur += '||'
        i += 1
        continue
      }
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter((p, idx) => idx === 0 || p.length)
}

function applyFilterChain(expr) {
  const parts = splitPipes(expr)
  if (parts.length < 2) return { code: expr, changed: false, filterNames: [] }
  let acc = parts[0]
  const filterNames = []
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]
    const m = part.match(/^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?$/)
    if (!m) return { code: expr, changed: false, filterNames: [] }
    const name = m[1]
    filterNames.push(name)
    const args = m[2] != null ? String(m[2]).trim() : ''
    acc = args ? name + '(' + acc + ', ' + args + ')' : name + '(' + acc + ')'
  }
  return { code: acc, changed: true, filterNames }
}

function rewriteMustacheFilters(code) {
  const changes = []
  const filterNames = []
  const out = String(code || '').replace(/\{\{([\s\S]*?)\}\}/g, (full, inner) => {
    if (inner.indexOf('|') === -1) return full
    const r = applyFilterChain(inner.trim())
    if (!r.changed) return full
    changes.push({ kind: 'filter-mustache', from: inner.trim().slice(0, 60), to: r.code.slice(0, 60) })
    ;(r.filterNames || []).forEach((n) => filterNames.push(n))
    return '{{ ' + r.code + ' }}'
  })
  return { code: out, changes, filterNames }
}

function rewriteBindFilters(code) {
  const changes = []
  const filterNames = []
  // :attr="..." / v-bind:attr="..." 且值含 |
  const out = String(code || '').replace(
    /((?:(?::)|(?:v-bind:))[A-Za-z_@:][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/g,
    (full, name, q, val) => {
      if (val.indexOf('|') === -1) return full
      if (/\|\|/.test(val) && !/\s\|\s/.test(val) && !/\|[A-Za-z_$]/.test(val)) return full
      const r = applyFilterChain(val.trim())
      if (!r.changed) return full
      changes.push({ kind: 'filter-bind', from: val.trim().slice(0, 60), to: r.code.slice(0, 60) })
      ;(r.filterNames || []).forEach((n) => filterNames.push(n))
      return name + '=' + q + r.code + q
    }
  )
  return { code: out, changes, filterNames }
}

function rewriteListenersAttr(code) {
  const changes = []
  let out = String(code || '')
  // v-on="$listeners" → v-bind="$attrs"；若同行已有 v-bind="$attrs" 则删掉 v-on
  out = out.replace(/\s+v-on\s*=\s*(["'])\$listeners\1/g, (m) => {
    changes.push({ kind: 'v-on-listeners-to-attrs' })
    return ' v-bind="$attrs"'
  })
  // 去重：同一标签上两个 v-bind="$attrs"
  out = out.replace(
    /<([A-Za-z][\w.-]*)(\s[^>]*?\bv-bind\s*=\s*(["'])\$attrs\3[^>]*?\bv-bind\s*=\s*(["'])\$attrs\4[^>]*)(\/?)>/g,
    (full, tag, attrs, q1, q2, slash) => {
      let seen = false
      const next = attrs.replace(/\s+v-bind\s*=\s*(["'])\$attrs\1/g, (m) => {
        if (seen) {
          changes.push({ kind: 'dedupe-v-bind-attrs' })
          return ''
        }
        seen = true
        return m
      })
      return '<' + tag + next + (slash || '') + '>'
    }
  )
  return { code: out, changes }
}

function migrateHtmlFiltersAndListeners(code) {
  const a = rewriteMustacheFilters(code)
  const b = rewriteBindFilters(a.code)
  const c = rewriteListenersAttr(b.code)
  const filterNames = [].concat(a.filterNames || [], b.filterNames || [])
  return {
    code: c.code,
    changes: [].concat(a.changes, b.changes, c.changes),
    filterNames,
  }
}

module.exports = {
  splitPipes,
  applyFilterChain,
  rewriteMustacheFilters,
  rewriteBindFilters,
  rewriteListenersAttr,
  migrateHtmlFiltersAndListeners,
}

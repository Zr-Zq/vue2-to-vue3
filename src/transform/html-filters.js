/**
 * Template filter | to function call (deterministic)
 * {{ a | f }} to {{ f(a) }}
 * {{ a | f(x) | g }} to {{ g(f(a, x)) }}
 * :title="a | f" to :title="f(a)"
 *
 * Also merge options.filters into methods (handled by js-filters-option)
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
      // Avoid ||
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
  // :attr="..." / v-bind:attr="..." whose value contains |
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
  // v-on="$listeners" to v-bind="$attrs"; if same tag already has v-bind="$attrs", drop v-on
  out = out.replace(/\s+v-on\s*=\s*(["'])\$listeners\1/g, (m) => {
    changes.push({ kind: 'v-on-listeners-to-attrs' })
    return ' v-bind="$attrs"'
  })
  // Dedupe: two v-bind="$attrs" on the same tag
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

/**
 * After a filter/method name collision, pipe call sites (mustache + v-bind only)
 * must call the aliased filter. Event handlers keep the method name.
 * @param {string} code template
 * @param {Record<string, string>} renames e.g. { upper: '__v23Filter_upper' }
 */
function rewriteFilterCallAliases(code, renames) {
  const map = renames || {}
  const keys = Object.keys(map).filter((k) => map[k] && map[k] !== k)
  if (!keys.length) return { code: String(code || ''), changes: [] }
  keys.sort((a, b) => b.length - a.length)
  const changes = []

  function rewriteExpr(expr) {
    let out = expr
    keys.forEach((from) => {
      const to = map[from]
      const re = new RegExp('\\b' + from.replace(/\$/g, '\\$') + '\\s*\\(', 'g')
      const next = out.replace(re, to + '(')
      if (next !== out) {
        changes.push({ kind: 'filter-call-alias', from, to })
        out = next
      }
    })
    return out
  }

  let out = String(code || '')
  out = out.replace(/\{\{([\s\S]*?)\}\}/g, (full, inner) => {
    const next = rewriteExpr(inner)
    return next === inner ? full : '{{' + next + '}}'
  })
  out = out.replace(
    /((?:(?::)|(?:v-bind:))[A-Za-z_@:][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/g,
    (full, name, q, val) => {
      const next = rewriteExpr(val)
      return next === val ? full : name + '=' + q + next + q
    }
  )
  return { code: out, changes }
}

module.exports = {
  splitPipes,
  applyFilterChain,
  rewriteMustacheFilters,
  rewriteBindFilters,
  rewriteListenersAttr,
  migrateHtmlFiltersAndListeners,
  rewriteFilterCallAliases,
}

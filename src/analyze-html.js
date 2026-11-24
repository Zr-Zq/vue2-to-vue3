/**
 * Vue SFC HTML (template) handling:
 * - Scan tags / attrs / interpolations by line
 * - Emit structured elements and Vue2→3 findings
 * No JS/Babel; external/empty scripts are not handled here.
 */
const { decomposeVue } = require('./sfc-parts')

/**
 * @typedef {{ line: number, column: number }} Loc
 * @typedef {{
 *   name: string,
 *   value: string|null,
 *   raw: string,
 *   loc: Loc,
 * }} HtmlAttr
 * @typedef {{
 *   tag: string,
 *   attrs: HtmlAttr[],
 *   attrsMap: Record<string,string|true>,
 *   selfClosing: boolean,
 *   closing: boolean,
 *   loc: Loc,
 *   endLoc: Loc,
 *   raw: string,
 * }} HtmlElement
 */

function offsetToLoc(code, offset) {
  const slice = String(code || '').slice(0, Math.max(0, offset))
  const lines = slice.split(/\r?\n/)
  return { line: lines.length, column: lines[lines.length - 1].length }
}

function addLoc(base, relative) {
  if (!base) return relative
  if (!relative) return { line: base.startLine || base.line || 1, column: relative?.column || 0 }
  // Relative line inside template → absolute file line
  const startLine = base.startLine || base.line || 1
  if (relative.line === 1) {
    // First line: column would also need template start column (approx: use line only)
    return { line: startLine, column: relative.column }
  }
  return { line: startLine + relative.line - 1, column: relative.column }
}

function parseAttrs(attrStr, code, attrStartOffset) {
  /** @type {HtmlAttr[]} */
  const attrs = []
  if (!attrStr) return attrs
  // Includes :[x] / @[x] / v-bind:[x] / @click.native / v-slot:foo
  const re =
    /((?:v-bind|v-on):\[[^\]]+\]|:[^\s="'`<>=]+|@[^\s="'`<>=]+|#[^\s="'`<>=]+|v-[\w:-]+|[\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`<>=]+)))?/g
  let m
  while ((m = re.exec(attrStr))) {
    const name = m[1]
    const value = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : null
    const localOff = attrStartOffset + m.index
    attrs.push({
      name,
      value,
      raw: m[0],
      loc: offsetToLoc(code, localOff),
    })
  }
  return attrs
}

/**
 * Scan template HTML source
 * @param {string} code template body (without <template> wrapper)
 */
function scanHtml(code) {
  const src = String(code || '')
  /** @type {HtmlElement[]} */
  const elements = []
  /** @type {{ text: string, loc: Loc, filters: string[] }[]} */
  const interpolations = []
  /** @type {{ text: string, loc: Loc }[]} */
  const comments = []

  const re =
    /<!--([\s\S]*?)-->|<\/([A-Za-z][\w.-]*)\s*>|<([A-Za-z][\w.-]*)(\s[^>]*?)?(\/?)>|{{([\s\S]*?)}}/g

  let m
  while ((m = re.exec(src))) {
    const loc = offsetToLoc(src, m.index)
    if (m[0].startsWith('<!--')) {
      comments.push({ text: m[1] || '', loc })
      continue
    }
    if (m[0].startsWith('{{')) {
      const text = (m[6] || '').trim()
      const filters = extractFilters(text)
      interpolations.push({ text, loc, filters })
      continue
    }
    if (m[2]) {
      elements.push({
        tag: m[2],
        attrs: [],
        attrsMap: {},
        selfClosing: false,
        closing: true,
        loc,
        endLoc: offsetToLoc(src, m.index + m[0].length),
        raw: m[0],
      })
      continue
    }

    const tag = m[3]
    const attrStr = m[4] || ''
    const selfClosing = m[5] === '/' || /\/>$/.test(m[0])
    const attrStart = m.index + 1 + tag.length
    const attrs = parseAttrs(attrStr, src, attrStart)
    const attrsMap = Object.create(null)
    attrs.forEach((a) => {
      attrsMap[a.name] = a.value == null ? true : a.value
    })
    elements.push({
      tag,
      attrs,
      attrsMap,
      selfClosing,
      closing: false,
      loc,
      endLoc: offsetToLoc(src, m.index + m[0].length),
      raw: m[0].slice(0, 200),
    })
  }

  return { elements, interpolations, comments }
}

function extractFilters(expr) {
  // Rough split: pipes; avoid ||
  const filters = []
  if (!expr || expr.indexOf('|') === -1) return filters
  // Strip | inside string literals
  const cleaned = String(expr)
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')
    .replace(/\|{2}/g, ' ')
  const parts = cleaned.split('|')
  if (parts.length < 2) return filters
  for (let i = 1; i < parts.length; i += 1) {
    const name = parts[i].trim().split(/\s*\(/)[0].trim()
    if (name) filters.push(name)
  }
  return filters
}

function hasFilterInBinding(value) {
  if (!value || typeof value !== 'string') return false
  return extractFilters(value).length > 0
}

function isDirectiveAttr(name) {
  return (
    name === 'v-for' ||
    name === 'v-if' ||
    name === 'v-else-if' ||
    name === 'v-else' ||
    name === 'v-show' ||
    name === 'v-model' ||
    name === 'v-bind' ||
    name === 'v-on' ||
    name === 'v-slot' ||
    name === 'v-html' ||
    name === 'v-text' ||
    name === 'v-cloak' ||
    name === 'v-once' ||
    name === 'v-pre' ||
    name === 'v-memo' ||
    name === 'slot' ||
    name === 'slot-scope' ||
    name === 'scope' ||
    name.startsWith('v-') ||
    name.startsWith(':') ||
    name.startsWith('@') ||
    name.startsWith('#') ||
    name.startsWith('v-bind:') ||
    name.startsWith('v-on:')
  )
}

/**
 * Build migration findings from scan results (loc relative to template)
 */
function collectHtmlFindings(scan, meta) {
  const findings = []
  const file = (meta && meta.file) || null
  const elements = scan.elements || []

  function push(f) {
    findings.push(
      Object.assign(
        {
          file,
          part: 'html',
          level: 'warn',
          auto: 'partial',
          evidence: '',
          hint: '',
          loc: null,
        },
        f
      )
    )
  }

  elements.forEach((el) => {
    if (el.closing) return
    const map = el.attrsMap
    const names = Object.keys(map)

    // v-for + v-if on same node → AI must decide Vue3 shape (:key on <template>, etc.)
    // Different nodes: no action (not reported).
    if (map['v-for'] != null && map['v-if'] != null) {
      const a = el.attrs.find((x) => x.name === 'v-for') || el.attrs[0]
      push({
        id: 'html.v-for-v-if',
        category: 'v-for-v-if',
        level: 'warn',
        auto: 'no',
        message: 'Same element uses both v-for and v-if (<' + el.tag + '>) — AI must migrate',
        evidence: (el.raw || '').slice(0, 120),
        hint:
          'Vue3: prefer <template v-for :key> + inner v-if; do not leave same-node combo. Different-node v-for/v-if: leave as-is.',
        loc: a ? a.loc : el.loc,
      })
    }

    // .native
    names.forEach((n) => {
      if (/\.native\b/.test(n) || (n.startsWith('@') && /\.native\b/.test(n))) {
        const a = el.attrs.find((x) => x.name === n)
        push({
          id: 'html.native',
          category: 'native-modifier',
          level: 'info',
          auto: 'yes',
          message: 'Uses .native modifier (' + n + ')',
          evidence: n + (map[n] !== true ? '=' + map[n] : ''),
          hint: 'Script removes .native',
          loc: a ? a.loc : el.loc,
        })
      }
    })

    // .sync
    names.forEach((n) => {
      if (/\.sync\b/.test(n)) {
        const a = el.attrs.find((x) => x.name === n)
        push({
          id: 'html.sync',
          category: 'sync-modifier',
          level: 'warn',
          auto: 'yes',
          message: 'Uses .sync modifier (' + n + ')',
          evidence: n,
          hint: 'Script rewrites to v-model:prop (do not only drop .sync or two-way updates are lost)',
          loc: a ? a.loc : el.loc,
        })
      }
    })

    // Dynamic arguments
    names.forEach((n) => {
      if (
        /^v-bind\s*:?\s*\[/.test(n) ||
        /^v-on\s*:?\s*\[/.test(n) ||
        /^:\[/.test(n) ||
        /^@\[/.test(n)
      ) {
        const a = el.attrs.find((x) => x.name === n)
        push({
          id: 'html.dynamic-args',
          category: 'dynamic-args',
          level: 'info',
          auto: 'yes',
          message: 'Dynamic arg/event ' + n,
          evidence: n,
          hint: 'Syntax often keeps; edge cases need regression',
          loc: a ? a.loc : el.loc,
        })
      }
    })

    // Filters in bindings
    el.attrs.forEach((a) => {
      if (!a.value) return
      if (!(a.name.startsWith(':') || a.name.startsWith('v-bind:') || a.name === 'v-bind')) return
      if (!hasFilterInBinding(a.value)) return
      push({
        id: 'html.filter-bind',
        category: 'filters',
        level: 'info',
        auto: 'yes',
        message: 'Filter pipe | in attribute binding',
        evidence: a.name + '="' + a.value.slice(0, 80) + '"',
        hint: 'Vue3 removed filters; use method or computed',
        loc: a.loc,
      })
    })

    // Legacy slot
    if (map.slot != null || map['slot-scope'] != null || map.scope != null) {
      const a =
        el.attrs.find((x) => x.name === 'slot' || x.name === 'slot-scope' || x.name === 'scope') ||
        el.attrs[0]
      push({
        id: 'html.legacy-slot',
        category: 'legacy-slot',
        level: 'warn',
        auto: 'yes',
        message:
          map['slot-scope'] != null || map.scope != null
            ? 'Legacy slot-scope / scope'
            : 'Legacy slot="' + map.slot + '"',
        evidence: (el.raw || '').slice(0, 120),
        hint: 'Can rewrite to v-slot / #',
        loc: a ? a.loc : el.loc,
      })
    }

    // keep-alive / component :is
    if (el.tag === 'keep-alive' || el.tag === 'KeepAlive') {
      push({
        id: 'html.keep-alive',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        message: 'Uses <keep-alive>',
        evidence: el.raw.slice(0, 80),
        hint: 'When combined with :is, script adds :key',
        loc: el.loc,
      })
    }
    if (
      (el.tag === 'component' || el.tag === 'Component') &&
      (map[':is'] != null || map['v-bind:is'] != null || map.is != null)
    ) {
      push({
        id: 'html.component-is',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        message: '<component :is> dynamic component',
        evidence: el.raw.slice(0, 80),
        hint: 'When combined with keep-alive, script adds :key',
        loc: el.loc,
      })
    }

    // :is on any tag
    if (map[':is'] != null || map['v-bind:is'] != null) {
      if (el.tag !== 'component' && el.tag !== 'Component') {
        push({
          id: 'html.is-attr',
          category: 'keepalive-combo',
          level: 'info',
          auto: 'yes',
          message: '<' + el.tag + ' :is> dynamic component',
          evidence: el.raw.slice(0, 80),
          loc: el.loc,
        })
      }
    }
  })

  // Interpolation filters
  ;(scan.interpolations || []).forEach((it) => {
    if (!it.filters || !it.filters.length) return
    push({
      id: 'html.filter-mustache',
      category: 'filters',
      level: 'warn',
      auto: 'yes',
      message: 'Template interpolation filter | ' + it.filters.join(', '),
      evidence: '{{ ' + it.text.slice(0, 80) + ' }}',
      hint: 'Script rewrites to function calls; merge filters option into methods',
      loc: it.loc,
    })
  })

  // Legacy slot mixed with v-slot
  let hasLegacy = false
  let hasVSlot = false
  elements.forEach((el) => {
    if (el.closing) return
    const map = el.attrsMap
    if (map.slot != null || map['slot-scope'] != null || map.scope != null) hasLegacy = true
    Object.keys(map).forEach((n) => {
      if (n === 'v-slot' || n.startsWith('v-slot:') || n.startsWith('#')) hasVSlot = true
    })
  })
  if (hasLegacy && hasVSlot) {
    push({
      id: 'html.legacy-slot-mix',
      category: 'legacy-slot',
      level: 'warn',
      auto: 'partial',
      message: 'Legacy slot mixed with v-slot',
      hint: 'Mixed usage needs manual confirmation',
      loc: { line: 1, column: 0 },
    })
  }

  return findings
}

function summarizeScan(scan, findings) {
  const tagCount = Object.create(null)
  const dirCount = Object.create(null)
  ;(scan.elements || []).forEach((el) => {
    if (el.closing) return
    tagCount[el.tag] = (tagCount[el.tag] || 0) + 1
    el.attrs.forEach((a) => {
      if (!isDirectiveAttr(a.name)) return
      const key = a.name.split('.')[0]
      dirCount[key] = (dirCount[key] || 0) + 1
    })
  })
  const byCat = Object.create(null)
  ;(findings || []).forEach((f) => {
    byCat[f.category] = (byCat[f.category] || 0) + 1
  })
  return {
    elementCount: (scan.elements || []).filter((e) => !e.closing).length,
    interpolationCount: (scan.interpolations || []).length,
    filterInterpolationCount: (scan.interpolations || []).filter((i) => i.filters.length).length,
    tagCount,
    directiveCount: dirCount,
    findingCount: (findings || []).length,
    findingsByCategory: byCat,
  }
}

/**
 * Analyze a template HTML snippet
 * @param {string} code
 * @param {{ file?: string, range?: { startLine: number }, templateAttrs?: object }} [meta]
 */
function analyzeHtmlTemplate(code, meta) {
  const opts = meta || {}
  const scan = scanHtml(code)
  let findings = collectHtmlFindings(scan, opts)

  // SFC <template functional>
  const tAttrs = opts.templateAttrs || {}
  if (tAttrs.functional != null || tAttrs.functional === '' || tAttrs.functional === true) {
    findings.push({
      id: 'html.template-functional',
      category: 'functional',
      level: 'info',
      auto: 'yes',
      part: 'html',
      file: opts.file || null,
      message: '<template functional> functional template',
      evidence: 'functional',
      hint: 'Script rewrites to normal component: $props / $attrs, drop listeners',
      loc: { line: 1, column: 0 },
    })
  }

  // Map to absolute file line numbers
  if (opts.range && opts.range.startLine) {
    findings = findings.map((f) =>
      Object.assign({}, f, {
        loc: f.loc ? addLoc(opts.range, f.loc) : null,
        templateLoc: f.loc,
      })
    )
  }

  return {
    kind: 'html',
    code: String(code || ''),
    elements: scan.elements,
    interpolations: scan.interpolations,
    comments: scan.comments,
    findings,
    summary: summarizeScan(scan, findings),
  }
}

/**
 * Analyze HTML parts from full .vue source
 */
function analyzeVueHtml(vueSource, absPath, fileRel) {
  const parts = decomposeVue(String(vueSource || ''), absPath || 'anon.vue')
  if (!parts.template || parts.template.code == null) {
    return {
      kind: 'html',
      code: '',
      elements: [],
      interpolations: [],
      comments: [],
      findings: [],
      summary: summarizeScan({ elements: [], interpolations: [] }, []),
      missing: true,
    }
  }
  const attrs = {}
  const rawAttrs = parts.template.attrs || parts.descriptor?.template?.attrs || {}
  Object.keys(rawAttrs || {}).forEach((k) => {
    attrs[k] = rawAttrs[k]
  })
  // vue2 parseComponent may put functional on template.attrs
  if (parts.descriptor && parts.descriptor.template) {
    const t = parts.descriptor.template
    if (t.attrs && t.attrs.functional != null) attrs.functional = t.attrs.functional
  }

  return analyzeHtmlTemplate(parts.template.code, {
    file: fileRel || null,
    range: parts.template.range,
    templateAttrs: attrs,
  })
}

module.exports = {
  scanHtml,
  analyzeHtmlTemplate,
  analyzeVueHtml,
  extractFilters,
  addLoc,
  offsetToLoc,
}

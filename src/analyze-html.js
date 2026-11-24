/**
 * Vue SFC 的 HTML（template）处理：
 * - 按行号扫描标签 / 属性 / 插值
 * - 产出结构化元素与 Vue2→3 相关 findings
 * 不走 JS/Babel；script 外链/空壳不在这里处理。
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
  // template 内相对行 → 文件绝对行
  const startLine = base.startLine || base.line || 1
  if (relative.line === 1) {
    // 首行：列也要加 template 起始列（粗略：只用行）
    return { line: startLine, column: relative.column }
  }
  return { line: startLine + relative.line - 1, column: relative.column }
}

function parseAttrs(attrStr, code, attrStartOffset) {
  /** @type {HtmlAttr[]} */
  const attrs = []
  if (!attrStr) return attrs
  // 含 :[x] / @[x] / v-bind:[x] / @click.native / v-slot:foo
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
 * 扫描 template HTML 源码
 * @param {string} code template 内容（不含 <template> 外壳）
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
  // 粗分：管道；避开 ||
  const filters = []
  if (!expr || expr.indexOf('|') === -1) return filters
  // 去掉字符串里的 |
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
 * 从扫描结果生成迁移 findings（loc 相对 template）
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

    // v-for + v-if 同节点
    if (map['v-for'] != null && map['v-if'] != null) {
      const a = el.attrs.find((x) => x.name === 'v-for') || el.attrs[0]
      push({
        id: 'html.v-for-v-if',
        category: 'v-for-v-if',
        level: 'info',
        auto: 'yes',
        message: '同元素同时使用 v-for 与 v-if（<' + el.tag + '>）',
        evidence: (el.raw || '').slice(0, 120),
        hint: '脚本拆成 <template v-for> + 内层 v-if（确定性）',
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
          message: '使用 .native 修饰符（' + n + '）',
          evidence: n + (map[n] !== true ? '=' + map[n] : ''),
          hint: '脚本去掉 .native',
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
          message: '使用 .sync 修饰符（' + n + '）',
          evidence: n,
          hint: '脚本改为 v-model:prop（不能只删 .sync，否则丢双向更新）',
          loc: a ? a.loc : el.loc,
        })
      }
    })

    // 动态参数
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
          message: '动态参数/事件 ' + n,
          evidence: n,
          hint: '语法多可保留，边角需回归',
          loc: a ? a.loc : el.loc,
        })
      }
    })

    // 绑定里的过滤器
    el.attrs.forEach((a) => {
      if (!a.value) return
      if (!(a.name.startsWith(':') || a.name.startsWith('v-bind:') || a.name === 'v-bind')) return
      if (!hasFilterInBinding(a.value)) return
      push({
        id: 'html.filter-bind',
        category: 'filters',
        level: 'info',
        auto: 'yes',
        message: '属性绑定中的过滤器管道 |',
        evidence: a.name + '="' + a.value.slice(0, 80) + '"',
        hint: 'Vue3 移除 filters；改方法或 computed',
        loc: a.loc,
      })
    })

    // 旧 slot
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
            ? '旧版 slot-scope / scope'
            : '旧版 slot="' + map.slot + '"',
        evidence: (el.raw || '').slice(0, 120),
        hint: '可改为 v-slot / #',
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
        message: '使用 <keep-alive>',
        evidence: el.raw.slice(0, 80),
        hint: '与 :is 组合时脚本补 :key',
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
        message: '<component :is> 动态组件',
        evidence: el.raw.slice(0, 80),
        hint: '与 keep-alive 组合时脚本补 :key',
        loc: el.loc,
      })
    }

    // 任意标签上的 :is
    if (map[':is'] != null || map['v-bind:is'] != null) {
      if (el.tag !== 'component' && el.tag !== 'Component') {
        push({
          id: 'html.is-attr',
          category: 'keepalive-combo',
          level: 'info',
          auto: 'yes',
          message: '<' + el.tag + ' :is> 动态组件',
          evidence: el.raw.slice(0, 80),
          loc: el.loc,
        })
      }
    }
  })

  // 插值过滤器
  ;(scan.interpolations || []).forEach((it) => {
    if (!it.filters || !it.filters.length) return
    push({
      id: 'html.filter-mustache',
      category: 'filters',
      level: 'warn',
      auto: 'yes',
      message: '模板插值过滤器 | ' + it.filters.join(', '),
      evidence: '{{ ' + it.text.slice(0, 80) + ' }}',
      hint: '脚本改为函数调用，filters 选项并入 methods',
      loc: it.loc,
    })
  })

  // 旧 slot 与 v-slot 混用
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
      message: '旧 slot 与 v-slot 混用',
      hint: '混写需人工确认',
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
 * 分析一段 template HTML
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
      message: '<template functional> 函数式模板',
      evidence: 'functional',
      hint: '脚本改为普通组件：$props / $attrs，去掉 listeners',
      loc: { line: 1, column: 0 },
    })
  }

  // 映射到文件绝对行号
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
 * 从整份 .vue 源码分析 HTML 部分
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
  // vue2 parseComponent 可能把 functional 放在 template.attrs
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

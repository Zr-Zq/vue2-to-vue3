/**
 * HTML/template auto-rewrites:
 * - :prop.sync / v-bind:prop.sync → v-model:prop (do not only drop .sync or updates are lost)
 * - @evt.native / v-on:evt.native → @evt / v-on:evt
 * - Legacy slot / slot-scope → #name / v-slot
 */

/**
 * :foo.sync="x" / v-bind:foo.sync="x" → v-model:foo="x"
 * Note: only removing .sync becomes one-way binding and changes behavior.
 */
function rewriteSync(code) {
  const changes = []
  let out = String(code || '')

  out = out.replace(
    /\bv-bind:([A-Za-z_][\w-]*)\.sync\s*=\s*(["'])([\s\S]*?)\2/g,
    (m, prop, q, expr) => {
      changes.push({ kind: 'sync', from: m, to: 'v-model:' + prop + '=' + q + expr + q })
      return 'v-model:' + prop + '=' + q + expr + q
    }
  )
  out = out.replace(
    /:([A-Za-z_][\w-]*)\.sync\s*=\s*(["'])([\s\S]*?)\2/g,
    (m, prop, q, expr) => {
      changes.push({ kind: 'sync', from: m, to: 'v-model:' + prop + '=' + q + expr + q })
      return 'v-model:' + prop + '=' + q + expr + q
    }
  )
  return { code: out, changes }
}

/** @click.native.stop → @click.stop ; drop native, keep other modifiers */
function rewriteNative(code) {
  const changes = []
  let out = String(code || '')

  out = out.replace(
    /(v-on:|@)([A-Za-z_][\w-]*)((?:\.[A-Za-z_][\w-]*)+)/g,
    (m, prefix, evt, mods) => {
      const segs = mods.split('.').filter(Boolean)
      if (!segs.includes('native')) return m
      const nextMods = segs.filter((s) => s !== 'native')
      const to = prefix + evt + (nextMods.length ? '.' + nextMods.join('.') : '')
      changes.push({ kind: 'native', from: m, to })
      return to
    }
  )

  return { code: out, changes }
}

/**
 * Whether current position is already inside same-named <template #name|slot="name"> (avoid nested v-slot)
 */
function enclosingTemplateSlotName(src, pos) {
  const stack = []
  const re = /<\/?template\b[^>]*>/gi
  let m
  while ((m = re.exec(src)) && m.index < pos) {
    const full = m[0]
    if (/^<\//.test(full)) {
      stack.pop()
      continue
    }
    let name = null
    const hash = full.match(/\s#([A-Za-z_][\w-]*)\b/)
    const vslot = full.match(/\sv-slot:([A-Za-z_][\w-]*)\b/)
    const legacy = full.match(/\sslot\s*=\s*(["'])([^"']*)\1/i)
    if (hash) name = hash[1]
    else if (vslot) name = vslot[1]
    else if (legacy) name = legacy[2]
    else if (/\sv-slot\s*=/.test(full)) name = 'default'
    stack.push(name)
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i]) return stack[i]
  }
  return null
}

/**
 * Legacy slots → unify to # / v-slot
 * - <template slot="a"> → <template #a>
 * - Element slot=: depth-pair wrap; if already inside same-named template slot, only drop slot attr (common for Element menu titles)
 */
function rewriteSlots(code) {
  const changes = []
  let out = String(code || '')

  // 1) <template ... slot / slot-scope ...>
  out = out.replace(/<template(\s[^>]*)>/gi, (full, attrStr) => {
    const slotM = attrStr.match(/\sslot\s*=\s*(["'])([^"']*)\1/i)
    const scopeM =
      attrStr.match(/\sslot-scope\s*=\s*(["'])([\s\S]*?)\1/i) ||
      attrStr.match(/\sscope\s*=\s*(["'])([\s\S]*?)\1/i)
    if (!slotM && !scopeM) return full

    let attrs = attrStr
    const slotName = slotM ? slotM[2] : 'default'
    const scopeExpr = scopeM ? scopeM[2] : null

    if (slotM) attrs = attrs.replace(slotM[0], '')
    if (scopeM) attrs = attrs.replace(scopeM[0], '')
    attrs = attrs.replace(/\sv-slot(?::[^\s=]+)?(\s*=\s*(["'])[\s\S]*?\2)?/g, '')
    attrs = attrs.replace(/\s#[A-Za-z_][\w-]*(\s*=\s*(["'])[\s\S]*?\2)?/g, '')

    const vslot = scopeExpr != null ? '#' + slotName + '=' + '"' + scopeExpr + '"' : '#' + slotName
    const next = '<template' + attrs + ' ' + vslot + '>'
    changes.push({ kind: 'slot-template', from: full, to: next })
    return next
  })

  // 2) Element slot= (incl. nested children): depth-pair; inside same-named outer template, only drop attr
  const pieces = []
  const startRe = /<([A-Za-z][\w.-]*)/g
  let m
  while ((m = startRe.exec(out))) {
    const tag = m[1]
    if (/^template$/i.test(tag)) continue
    const scanned = scanOpenTagAttrs(out, m.index + m[0].length)
    if (!scanned) continue
    const attrs = scanned.attrs
    const slotM = attrs.match(/\sslot\s*=\s*(["'])([^"']*)\1/i)
    if (!slotM) continue
    const slotName = slotM[2]
    const scopeM =
      attrs.match(/\sslot-scope\s*=\s*(["'])([\s\S]*?)\1/i) ||
      attrs.match(/\sscope\s*=\s*(["'])([\s\S]*?)\1/i)

    let nextAttrs = attrs
      .replace(/\sslot\s*=\s*(["'])([^"']*)\1/i, '')
      .replace(/\sslot-scope\s*=\s*(["'])([\s\S]*?)\1/i, '')
      .replace(/\sscope\s*=\s*(["'])([\s\S]*?)\1/i, '')

    const parentSlot = enclosingTemplateSlotName(out, m.index)
    if (parentSlot && parentSlot === slotName && !scopeM) {
      // Already inside same-named slot template: only drop slot, avoid nesting another <template #title>
      const openStart = m.index
      const openEnd = scanned.end
      const oldOpen = out.slice(openStart, openEnd)
      const newOpen = scanned.selfClose
        ? '<' + tag + nextAttrs + ( /\/\s*$/.test(nextAttrs) ? '>' : ' />')
        : '<' + tag + nextAttrs + '>'
      // Normalize selfClose
      const replacement = scanned.selfClose
        ? '<' + tag + nextAttrs.replace(/\s*\/\s*$/, '') + ' />'
        : '<' + tag + nextAttrs + '>'
      pieces.push({ start: openStart, end: openEnd, text: replacement })
      changes.push({ kind: 'slot-strip-nested', from: oldOpen, to: replacement })
      startRe.lastIndex = openEnd
      continue
    }

    if (scanned.selfClose) {
      const openStart = m.index
      const openEnd = scanned.end
      const vslot = '#' + slotName
      const wrapped =
        '<template ' + vslot + '><' + tag + nextAttrs.replace(/\s*\/\s*$/, '') + ' /></template>'
      pieces.push({ start: openStart, end: openEnd, text: wrapped })
      changes.push({ kind: 'slot-wrap-self', from: out.slice(openStart, openEnd), to: wrapped })
      startRe.lastIndex = openEnd
      continue
    }

    const closeEnd = findMatchingClose(out, scanned.end, tag)
    if (closeEnd < 0) continue
    const closeMatch = out.slice(scanned.end, closeEnd).match(new RegExp('</' + tag + '\\s*>$', 'i'))
    const innerReal = closeMatch
      ? out.slice(scanned.end, closeEnd - closeMatch[0].length)
      : out.slice(scanned.end, closeEnd)
    const vslot = scopeM != null ? '#' + slotName + '="' + scopeM[2] + '"' : '#' + slotName
    const wrapped =
      '<template ' +
      vslot +
      '><' +
      tag +
      nextAttrs +
      '>' +
      innerReal +
      '</' +
      tag +
      '></template>'
    pieces.push({ start: m.index, end: closeEnd, text: wrapped })
    changes.push({ kind: scopeM ? 'slot-wrap-scope' : 'slot-wrap', from: out.slice(m.index, m.index + 60), to: wrapped.slice(0, 60) })
    startRe.lastIndex = closeEnd
  }

  if (pieces.length) {
    let next = ''
    let last = 0
    pieces.forEach((p) => {
      next += out.slice(last, p.start) + p.text
      last = p.end
    })
    next += out.slice(last)
    out = next
  }

  return { code: out, changes }
}

/**
 * Scan open-tag attrs after tagName until the real `>` (skip `>` inside quotes/comments)
 * @returns {{ attrs: string, end: number, selfClose: boolean } | null}
 */
function scanOpenTagAttrs(src, nameEnd) {
  let i = nameEnd
  let quote = null
  while (i < src.length) {
    const ch = src[i]
    if (quote) {
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      i += 1
      continue
    }
    if (ch === '<' && src.slice(i, i + 4) === '<!--') {
      const end = src.indexOf('-->', i + 4)
      i = end === -1 ? src.length : end + 3
      continue
    }
    if (ch === '>') {
      const attrs = src.slice(nameEnd, i)
      const selfClose = /\/\s*$/.test(attrs)
      return { attrs, end: i + 1, selfClose }
    }
    i += 1
  }
  return null
}

/**
 * Find closing-tag end aligned with openStart (simple same-name depth count)
 */
function findMatchingClose(src, openEnd, tag) {
  const openRe = new RegExp('<' + tag + '\\b', 'gi')
  const closeRe = new RegExp('</' + tag + '\\s*>', 'gi')
  let depth = 1
  let i = openEnd
  while (i < src.length && depth > 0) {
    openRe.lastIndex = i
    closeRe.lastIndex = i
    const o = openRe.exec(src)
    const c = closeRe.exec(src)
    if (!c) return -1
    if (o && o.index < c.index) {
      // Skip comment/string false hits: only when it is truly an open tag
      const after = o.index + o[0].length
      if (src[after] === '>' || /\s|\//.test(src[after] || '')) {
        depth += 1
        i = after
      } else {
        i = after
      }
    } else {
      depth -= 1
      if (depth === 0) return c.index + c[0].length
      i = c.index + c[0].length
    }
  }
  return -1
}

/**
 * Same-node v-for + v-if → <template v-for> + inner v-if
 * Put :key on the inner real element (Vue2 forbids key on template; Vue3 compatible too)
 */
function rewriteVForVIf(code) {
  const changes = []
  const src = String(code || '')
  const pieces = []
  const startRe = /<([A-Za-z][\w.-]*)/g
  let m
  while ((m = startRe.exec(src))) {
    const tag = m[1]
    if (/^template$/i.test(tag)) continue
    const scanned = scanOpenTagAttrs(src, m.index + m[0].length)
    if (!scanned || scanned.selfClose) continue
    const attrs = scanned.attrs
    if (!/\bv-for\s*=/.test(attrs) || !/\bv-if\s*=/.test(attrs)) continue

    const forM = attrs.match(/\sv-for\s*=\s*(["'])([\s\S]*?)\1/i)
    const ifM = attrs.match(/\sv-if\s*=\s*(["'])([\s\S]*?)\1/i)
    if (!forM || !ifM) continue

    const closeEnd = findMatchingClose(src, scanned.end, tag)
    if (closeEnd < 0) continue

    const openStart = m.index
    const closeMatch = src.slice(scanned.end, closeEnd).match(new RegExp('</' + tag + '\\s*>$', 'i'))
    const innerReal = closeMatch
      ? src.slice(scanned.end, closeEnd - closeMatch[0].length)
      : src.slice(scanned.end, closeEnd)

    const keyM =
      attrs.match(/\s(?::key|v-bind:key)\s*=\s*(["'])([\s\S]*?)\1/i) ||
      attrs.match(/\skey\s*=\s*(["'])([\s\S]*?)\1/i)

    let nextAttrs = attrs
      .replace(/\sv-for\s*=\s*(["'])([\s\S]*?)\1/i, '')
      .replace(/\sv-if\s*=\s*(["'])([\s\S]*?)\1/i, '')
    if (keyM) nextAttrs = nextAttrs.replace(keyM[0], '')
    nextAttrs = nextAttrs.replace(/<!--[\s\S]*?-->/g, '')

    // Put key on inner element for Vue2 compatibility
    const keyAttr = keyM ? ' :key=' + keyM[1] + keyM[2] + keyM[1] : ''
    const wrapped =
      '<template v-for=' +
      forM[1] +
      forM[2] +
      forM[1] +
      '><' +
      tag +
      nextAttrs +
      keyAttr +
      ' v-if=' +
      ifM[1] +
      ifM[2] +
      ifM[1] +
      '>' +
      innerReal +
      '</' +
      tag +
      '></template>'

    pieces.push({ start: openStart, end: closeEnd, text: wrapped })
    changes.push({
      kind: 'v-for-v-if-split',
      from: src.slice(openStart, Math.min(openStart + 80, closeEnd)),
      to: wrapped.slice(0, 80),
    })
    startRe.lastIndex = closeEnd
  }

  if (!pieces.length) return { code: src, changes }

  let out = ''
  let last = 0
  pieces.forEach((p) => {
    out += src.slice(last, p.start) + p.text
    last = p.end
  })
  out += src.slice(last)
  return { code: out, changes }
}

/**
 * Inside <keep-alive>, if <component :is="x"> lacks :key, add :key="x"
 * (combo itself is script-handled; no longer treated as a risk)
 */
function rewriteKeepAliveIsKey(code) {
  const changes = []
  let out = String(code || '')

  out = out.replace(/<keep-alive(\s[^>]*)?>([\s\S]*?)<\/keep-alive>/gi, (full, attrs, inner) => {
    function injectKey(m, tag, attrStr, q, isExpr, slash) {
      const clean = String(attrStr || '').replace(/\s*\/\s*$/, '')
      if (/\s:key\s*=|\sv-bind:key\s*=|\skey\s*=/.test(clean)) return m
      const selfClose = slash === '/' || /\/\s*$/.test(attrStr || '')
      const to =
        '<' + tag + clean + ' :key=' + q + isExpr + q + (selfClose ? ' />' : '>')
      changes.push({ kind: 'keepalive-is-key', from: m, to })
      return to
    }
    const nextInner = inner.replace(
      /<(component|Component)(\s[^>]*?(?::is|v-bind:is)\s*=\s*(["'])([^"']*)\3[^>]*?)(\/?)\s*>/g,
      injectKey
    )
    // Also handle :is on non-component tags
    const next2 = nextInner.replace(
      /<([A-Za-z][\w.-]*)(\s[^>]*?(?::is|v-bind:is)\s*=\s*(["'])([^"']*)\3[^>]*?)(\/?)\s*>/g,
      (m, tag, attrStr, q, isExpr, slash) => {
        if (/^(component|Component|keep-alive|KeepAlive)$/i.test(tag)) return m
        return injectKey(m, tag, attrStr, q, isExpr, slash)
      }
    )
    if (next2 === inner) return full
    return '<keep-alive' + (attrs || '') + '>' + next2 + '</keep-alive>'
  })

  return { code: out, changes }
}

/**
 * Vue2: :key on <template v-for> is forbidden — move to first real child.
 * (If inner :key already exists, only drop key on template)
 */
function rewriteTemplateVForKey(code) {
  const changes = []
  const src = String(code || '')
  const re = /<template(\s[^>]*?\bv-for\s*=\s*(["'])[\s\S]*?\2[^>]*)>/gi
  let out = src
  let m
  const edits = []
  while ((m = re.exec(src))) {
    const openFull = m[0]
    const attrs = m[1] || ''
    const keyM =
      attrs.match(/\s(?::key|v-bind:key)\s*=\s*(["'])([\s\S]*?)\1/i) ||
      attrs.match(/\skey\s*=\s*(["'])([\s\S]*?)\1/i)
    if (!keyM) continue
    const openStart = m.index
    const openEnd = m.index + openFull.length
    const closeEnd = findMatchingClose(src, openEnd, 'template')
    if (closeEnd < 0) continue
    const closeMatch = src.slice(openEnd, closeEnd).match(/<\/template\s*>$/i)
    const inner = closeMatch
      ? src.slice(openEnd, closeEnd - closeMatch[0].length)
      : src.slice(openEnd, closeEnd)

    const nextAttrs = attrs.replace(keyM[0], '')
    const keyAttr = ' :key=' + keyM[1] + keyM[2] + keyM[1]
    let nextInner = inner
    const child = inner.match(/^\s*<([A-Za-z][\w.-]*)(\s[^>]*)?(\/?)>/)
    if (child && !/^template$/i.test(child[1])) {
      const childAttrs = child[2] || ''
      if (!/\s(?::key|v-bind:key|key)\s*=/.test(childAttrs)) {
        if (child[3]) {
          // self-closing
          nextInner = inner.replace(child[0], child[0].replace(/\s*\/>$/, keyAttr + ' />'))
        } else {
          nextInner = inner.replace(
            child[0],
            '<' + child[1] + childAttrs + keyAttr + '>'
          )
        }
      }
    }
    const nextOpen = '<template' + nextAttrs + '>'
    edits.push({
      start: openStart,
      end: closeEnd,
      text: nextOpen + nextInner + (closeMatch ? closeMatch[0] : '</template>'),
    })
    changes.push({ kind: 'template-vfor-key-to-child', key: keyM[2] })
  }
  edits.sort((a, b) => b.start - a.start)
  edits.forEach((e) => {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  })
  return { code: out, changes }
}

function migrateHtmlTemplate(code) {
  const { migrateHtmlFiltersAndListeners } = require('./html-filters')
  const a = rewriteSync(code)
  const b = rewriteNative(a.code)
  const c = rewriteSlots(b.code)
  // Same-node v-for+v-if is AI-owned (Vue3 key-on-template semantics); do not auto-split.
  // Different-node v-for / v-if needs no migration.
  const d = rewriteTemplateVForKey(c.code)
  const e = rewriteKeepAliveIsKey(d.code)
  const f = migrateHtmlFiltersAndListeners(e.code)
  return {
    code: f.code,
    changes: [].concat(a.changes, b.changes, c.changes, d.changes, e.changes, f.changes),
    filterNames: f.filterNames || [],
  }
}

module.exports = {
  rewriteSync,
  rewriteNative,
  rewriteSlots,
  rewriteVForVIf,
  rewriteTemplateVForKey,
  rewriteKeepAliveIsKey,
  migrateHtmlTemplate,
}

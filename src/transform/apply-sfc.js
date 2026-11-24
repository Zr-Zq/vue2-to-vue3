/**
 * Merge template / script rewrites back into the full .vue
 * Must slice-write via SFC block start/end (compiler content may be de-indented; do not indexOf-replace)
 */
const { decomposeVue } = require('../sfc-parts')

function replaceOnce(haystack, needle, next) {
  if (needle == null || next === needle) return haystack
  const idx = haystack.indexOf(needle)
  if (idx === -1) return haystack
  return haystack.slice(0, idx) + next + haystack.slice(idx + needle.length)
}

function spliceByOffset(src, start, end, text) {
  if (start == null || end == null || start < 0 || end < start) return src
  return src.slice(0, start) + text + src.slice(end)
}

/**
 * @param {string} vueSource
 * @param {(tpl: string) => { code: string, changes: any[] }} templateFn
 * @param {(js: string, meta: object) => { code: string, changes: any[] }} [scriptFn]
 * @param {(css: string, meta: object) => { code: string, changes: any[] }} [styleFn]
 */
function applySfcTransforms(vueSource, absPath, templateFn, scriptFn, styleFn) {
  const raw = String(vueSource || '')
  const parts = decomposeVue(raw, absPath || 'anon.vue')
  const edits = []
  const changes = []
  const meta = { filterNames: [] }

  if (templateFn && parts.template && parts.template.code != null) {
    const srcCode = parts.template.code
    const result = templateFn(srcCode) || { code: srcCode, changes: [] }
    if (result.filterNames && result.filterNames.length) {
      meta.filterNames.push(...result.filterNames)
    }
    if (result.code !== srcCode) {
      const range = parts.template.range
      if (range && typeof range.startOffset === 'number') {
        edits.push({
          start: range.startOffset,
          end: range.endOffset,
          text: result.code,
          part: 'html',
        })
      } else {
        // Fallback: string replace (may fail)
        edits.push({ needle: srcCode, text: result.code, part: 'html' })
      }
      changes.push(...(result.changes || []).map((c) => Object.assign({ part: 'html' }, c)))
    }
  }

  if (scriptFn && parts.jsParts) {
    parts.jsParts.forEach((entry) => {
      const result =
        scriptFn(entry.code, { id: entry.id, lang: entry.lang, setup: entry.setup }) || {
          code: entry.code,
          changes: [],
        }
      if (result.code === entry.code) return
      const range = entry.range
      if (range && typeof range.startOffset === 'number') {
        edits.push({
          start: range.startOffset,
          end: range.endOffset,
          text: result.code,
          part: 'js',
          scriptId: entry.id,
        })
      } else {
        edits.push({ needle: entry.code, text: result.code, part: 'js', scriptId: entry.id })
      }
      changes.push(
        ...(result.changes || []).map((c) =>
          Object.assign({ part: 'js', scriptId: entry.id }, c)
        )
      )
    })
  }

  if (styleFn && parts.styles) {
    parts.styles.forEach((entry) => {
      const result =
        styleFn(entry.code, { id: entry.id, lang: entry.lang, scoped: entry.scoped }) || {
          code: entry.code,
          changes: [],
        }
      if (result.code === entry.code) return
      const range = entry.range
      if (range && typeof range.startOffset === 'number') {
        edits.push({
          start: range.startOffset,
          end: range.endOffset,
          text: result.code,
          part: 'style',
          styleId: entry.id,
        })
      } else {
        edits.push({ needle: entry.code, text: result.code, part: 'style', styleId: entry.id })
      }
      changes.push(
        ...(result.changes || []).map((c) =>
          Object.assign({ part: 'style', styleId: entry.id }, c)
        )
      )
    })
  }

  // Apply from back to front to avoid offset drift
  edits.sort((a, b) => {
    const as = a.start != null ? a.start : 0
    const bs = b.start != null ? b.start : 0
    return bs - as
  })

  let out = raw
  edits.forEach((e) => {
    if (e.start != null) {
      out = spliceByOffset(out, e.start, e.end, e.text)
    } else if (e.needle != null) {
      out = replaceOnce(out, e.needle, e.text)
    }
  })

  return { content: out, changes, edits: edits.length, meta }
}

module.exports = {
  applySfcTransforms,
  replaceOnce,
  spliceByOffset,
}

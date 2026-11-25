/**
 * Normalize Vue2 deep selectors to Vue3 `:deep(...)`.
 *
 * Handles:
 *   ::v-deep .sel / ::v-deep.sel  to :deep(.sel)   (batch-replace style)
 *   ::v-deep(.sel)                to :deep(.sel)
 *   ::deep(.sel)                  to :deep(.sel)
 *   >>> .sel / /deep/ .sel        to :deep(.sel)
 *   leftover >>> / /deep/         to :deep
 *
 * Already-correct `:deep(...)` is left unchanged.
 */

/** Selector after a deep combinator (same idea as the ::v-deep batch replace). */
const DEEP_SEL =
  '([.#*:\\[a-zA-Z_-][^,{\\n]*?)\\s*(?=,|\\{|$)'

function migrateCssDeep(code) {
  const changes = []
  let out = String(code || '')

  // ::v-deep(.foo) / ::deep(.foo) to :deep(.foo)
  out = out.replace(/::v-deep\s*\(([^)]+)\)/g, (m, inner) => {
    changes.push({ kind: 'v-deep-paren', from: m.slice(0, 40) })
    return ':deep(' + String(inner).trim() + ')'
  })
  out = out.replace(/::deep\s*\(([^)]+)\)/g, (m, inner) => {
    changes.push({ kind: 'colon-deep-paren', from: m.slice(0, 40) })
    return ':deep(' + String(inner).trim() + ')'
  })

  // ::v-deep\s*selector to :deep(selector)
  // Find: ::v-deep\s*([.#*:\[a-zA-Z_-][^,{\n]*?)\s*(?=,|\{|$)
  // Replace: :deep($1)
  out = out.replace(new RegExp('::v-deep\\s*' + DEEP_SEL, 'g'), (m, sel) => {
    const s = String(sel).trim()
    if (!s) return m
    changes.push({ kind: 'v-deep-space', from: m.slice(0, 40) })
    return ':deep(' + s + ')'
  })

  // >>> selector / /deep/ selector to :deep(selector)
  out = out.replace(new RegExp('(?:>>>|\\/deep\\/)\\s*' + DEEP_SEL, 'g'), (m, sel) => {
    const s = String(sel).trim()
    if (!s) return m
    changes.push({ kind: 'deep-combinator', from: m.slice(0, 40) })
    return ':deep(' + s + ')'
  })

  // Bare leftovers (no following selector captured)
  out = out.replace(/::v-deep\b/g, () => {
    changes.push({ kind: 'v-deep-token' })
    return ':deep'
  })
  out = out.replace(/(?:\/deep\/|>>>)/g, () => {
    changes.push({ kind: 'deep-token' })
    return ':deep'
  })

  return { code: out, changes }
}

module.exports = {
  migrateCssDeep,
}

/**
 * 深度选择器统一为 ::v-deep（Vue2 vue-loader15 + Vue3 均可用）
 * >>> /deep/ :deep() → ::v-deep
 */
function migrateCssDeep(code) {
  const changes = []
  let out = String(code || '')

  // :deep(.foo) → ::v-deep(.foo)
  out = out.replace(/:deep\s*\(([^)]+)\)/g, (m, inner) => {
    changes.push({ kind: 'deep-paren-from-colon', from: m.slice(0, 40) })
    return '::v-deep(' + inner.trim() + ')'
  })

  // ::v-deep(.foo) 已是目标，保留
  // ::v-deep .foo  /  /deep/ .foo  /  >>> .foo → ::v-deep .foo
  out = out.replace(/(::v-deep|\/deep\/|>>>)\s+([^\{\};]+)/g, (m, kw, sel) => {
    const s = String(sel).trim()
    if (!s) return m
    if (kw === '::v-deep') return m
    changes.push({ kind: 'deep-space', from: m.slice(0, 40) })
    return '::v-deep ' + s
  })

  // 仅 >>> 或 /deep/ 残留
  out = out.replace(/(?:\/deep\/|>>>)/g, () => {
    changes.push({ kind: 'deep-token' })
    return '::v-deep'
  })

  return { code: out, changes }
}

module.exports = {
  migrateCssDeep,
}

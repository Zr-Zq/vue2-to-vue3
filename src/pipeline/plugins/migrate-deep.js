const { createPlugin } = require('../create-plugin')
const { migrateCssDeep } = require('../../transform/css-deep')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-deep',
  description: '>>> /deep/ ::v-deep / ::deep() to :deep()',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /::v-deep|::deep\s*\(|\/deep\/|>>>/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const ext = ctx.file.ext
    if (ext === '.vue') {
      const result = applySfcTransforms(
        ctx.file.content,
        ctx.file.absPath,
        null,
        null,
        (css) => migrateCssDeep(css)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-deep')
        ctx.report({
          level: 'info',
          plugin: 'migrate-deep',
          message: 'deep selectors ×' + result.changes.length,
        })
      }
      return
    }
    if (/\.(css|scss|sass|less)$/.test(ext)) {
      const result = migrateCssDeep(ctx.file.content)
      if (result.changes.length && result.code !== ctx.file.content) {
        ctx.setContent(result.code, 'migrate-deep')
        ctx.report({
          level: 'info',
          plugin: 'migrate-deep',
          message: 'deep selectors ×' + result.changes.length,
        })
      }
    }
  },
})

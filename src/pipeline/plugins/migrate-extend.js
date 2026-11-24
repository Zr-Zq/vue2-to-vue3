const { createPlugin } = require('../create-plugin')
const { migrateExtend } = require('../../transform/js-extend')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-extend',
  description: 'Vue.extend / Sub.extend → defineComponent',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /\.extend\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js) =>
        migrateExtend(js)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-extend')
        ctx.report({
          level: 'info',
          plugin: 'migrate-extend',
          message: 'extend rewrites ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateExtend(ctx.file.content)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-extend')
      ctx.report({
        level: 'info',
        plugin: 'migrate-extend',
        message: 'extend rewrites ×' + result.changes.length,
      })
    }
  },
})

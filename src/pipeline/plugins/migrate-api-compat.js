const { createPlugin } = require('../create-plugin')
const { migrateApiCompat } = require('../../transform/js-api-compat')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-api-compat',
  description: 'lifecycle/$set/$delete/$listeners/$scopedSlots/productionTip',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /beforeDestroy|\bdestroyed\b|\$set\b|\$delete\b|Vue\.set|Vue\.delete|\$listeners|\$scopedSlots|productionTip|\.silent\b/.test(
      ctx.file.content
    )
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
        migrateApiCompat(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-api-compat')
        ctx.report({
          level: 'info',
          plugin: 'migrate-api-compat',
          message: 'api-compat rewrites ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateApiCompat(ctx.file.content, ctx.file.absPath)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-api-compat')
      ctx.report({
        level: 'info',
        plugin: 'migrate-api-compat',
        message: 'api-compat rewrites ×' + result.changes.length,
      })
    }
  },
})

const { createPlugin } = require('../create-plugin')
const { migrateDirectiveHooks } = require('../../transform/js-directive-hooks')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-directive-hooks',
  description: 'Directive hooks bind/inserted/... → beforeMount/mounted/...',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /directives\s*:|Vue\.directive/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
        migrateDirectiveHooks(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-directive-hooks')
        ctx.report({
          level: 'info',
          plugin: 'migrate-directive-hooks',
          message: 'directive-hooks rewrites ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateDirectiveHooks(ctx.file.content, ctx.file.absPath)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-directive-hooks')
      ctx.report({
        level: 'info',
        plugin: 'migrate-directive-hooks',
        message: 'directive-hooks rewrites ×' + result.changes.length,
      })
    }
  },
})

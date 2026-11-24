const { createPlugin } = require('../create-plugin')
const { migrateChildren } = require('../../transform/js-children')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-children',
  description: 'this.$children → __v23Children(this) 辅助函数',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /\$children\b/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js) =>
        migrateChildren(js)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-children')
        ctx.report({
          level: 'info',
          plugin: 'migrate-children',
          message: 'children 改写 ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateChildren(ctx.file.content)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-children')
      ctx.report({
        level: 'info',
        plugin: 'migrate-children',
        message: 'children 改写 ×' + result.changes.length,
      })
    }
  },
})

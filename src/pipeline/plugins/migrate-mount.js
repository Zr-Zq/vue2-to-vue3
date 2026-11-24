const { createPlugin } = require('../create-plugin')
const { migrateMount } = require('../../transform/js-mount')
const { applySfcTransforms } = require('../../transform/apply-sfc')

module.exports = createPlugin({
  name: 'migrate-mount',
  description: 'new Vue().$mount → createApp().mount',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /new\s+Vue\s*\(|\.\$mount\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js) =>
        migrateMount(js)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-mount')
        ctx.report({
          level: 'info',
          plugin: 'migrate-mount',
          message: 'mount 改写 ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateMount(ctx.file.content)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-mount')
      ctx.report({
        level: 'info',
        plugin: 'migrate-mount',
        message: 'mount 改写 ×' + result.changes.length,
      })
    }
  },
})

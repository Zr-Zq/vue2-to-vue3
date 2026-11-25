const path = require('path')
const { createPlugin } = require('../create-plugin')
const { migrateRenderH } = require('../../transform/js-render-h')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * Automatic rewrite of render(h) (independently testable).
 */
module.exports = createPlugin({
  name: 'migrate-render-h',
  description: 'Rewrite render(h) to h import + drop arg / $scopedSlots',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /\brender\s*\(\s*h\s*\)|\brender\s*:\s*\(\s*h\s*\)|\$scopedSlots/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const ext = ctx.file.ext
    if (ext === '.vue') {
      const result = applySfcTransforms(
        ctx.file.content,
        ctx.file.absPath,
        null,
        (js, meta) => migrateRenderH(js, ctx.file.absPath + '?' + (meta && meta.id))
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-render-h')
        ctx.report({
          level: 'info',
          plugin: 'migrate-render-h',
          message: 'render-h rewrites ×' + result.changes.length,
        })
      }
      return
    }
    const result = migrateRenderH(ctx.file.content, ctx.file.absPath || ctx.file.path)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-render-h')
      ctx.report({
        level: 'info',
        plugin: 'migrate-render-h',
        message: 'render-h rewrites ×' + result.changes.length,
      })
    }
  },
})

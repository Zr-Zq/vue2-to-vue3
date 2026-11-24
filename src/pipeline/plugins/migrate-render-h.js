const path = require('path')
const { createPlugin } = require('../create-plugin')
const { migrateRenderH } = require('../../transform/js-render-h')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * render(h) 自动改写（单独可测）
 */
module.exports = createPlugin({
  name: 'migrate-render-h',
  description: '自动改写 render(h) → h import + 去参 / $scopedSlots',
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
          message: 'render-h 改写 ×' + result.changes.length,
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
        message: 'render-h 改写 ×' + result.changes.length,
      })
    }
  },
})

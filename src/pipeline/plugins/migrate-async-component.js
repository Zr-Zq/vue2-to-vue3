const { createPlugin } = require('../create-plugin')
const { migrateAsyncComponent } = require('../../transform/js-async-component')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * Vue2 async factories → defineAsyncComponent (deterministic).
 * Runs before options→script-setup so hoisted components keep the wrap.
 */

function looksLike(code) {
  const s = String(code || '')
  if (!s.includes('import(')) return false
  return (
    /=>\s*import\s*\(/.test(s) ||
    /component\s*:\s*import\s*\(/.test(s) ||
    /Vue\.component\s*\([^)]*import\s*\(/.test(s)
  )
}

module.exports = createPlugin({
  name: 'migrate-async-component',
  description: 'Async factories → defineAsyncComponent; map loading/error/delay fields',
  version: '0.1.0',
  defaults: { enabled: true, stream: 'js' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return looksLike(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return

    if (ctx.file.ext === '.vue' || ctx.file.kind === 'vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
        migrateAsyncComponent(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-async-component')
        ctx.report({
          level: 'info',
          plugin: 'migrate-async-component',
          message: 'async→defineAsyncComponent changes ×' + result.changes.length,
        })
      }
      return
    }

    const result = migrateAsyncComponent(ctx.file.content, ctx.file.absPath)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-async-component')
      ctx.report({
        level: 'info',
        plugin: 'migrate-async-component',
        message: 'async→defineAsyncComponent changes ×' + result.changes.length,
      })
    }
  },
})

const { createPlugin } = require('../create-plugin')
const { migrateDynamicImport } = require('../../transform/js-dynamic-import')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * webpack context-style import('@/x/' + name + '.vue') to Vite import.meta.glob lookup.
 * Runs before migrate-async-component; the rewritten call still sits inside `() => …`.
 */
module.exports = createPlugin({
  name: 'migrate-dynamic-import',
  description: "import('@/dir/' + name + '.ext') to import.meta.glob lookup (Vite cannot analyze it)",
  version: '0.1.0',
  defaults: { enabled: true, stream: 'js' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return /import\s*\(\s*(['"`][^'"`]*['"`]\s*\+|`[^`]*\$\{)/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const opts = { filename: ctx.file.absPath, projectRoot: api.project && api.project.root }
    const isVue = ctx.file.ext === '.vue' || ctx.file.kind === 'vue'
    let next
    let count
    if (isVue) {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js) =>
        migrateDynamicImport(js, opts)
      )
      next = result.content
      count = result.changes.length
    } else {
      const result = migrateDynamicImport(ctx.file.content, opts)
      next = result.code
      count = result.changes.length
    }
    if (count && next !== ctx.file.content) {
      ctx.setContent(next, 'migrate-dynamic-import')
      ctx.report({
        level: 'info',
        plugin: 'migrate-dynamic-import',
        message: 'dynamic import to import.meta.glob ×' + count,
      })
    }
  },
})

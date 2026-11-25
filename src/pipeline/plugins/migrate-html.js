const { createPlugin } = require('../create-plugin')
const { migrateHtmlTemplate } = require('../../transform/html-directives')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const { addFiltersHandoff, flushHandoff } = require('../../handoff')

/**
 * HTML stream: rewrite template only (sync / native / slot / v-for+v-if / keep-alive / |filtertocall).
 * filterstomethods belongs to the JS stream; here only write .v23/handoff.json items.
 */
module.exports = createPlugin({
  name: 'migrate-html',
  description: 'HTML stream: rewrite template; hand off filters to JS stream',
  version: '0.2.0',
  defaults: { enabled: true, stream: 'html' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return ctx.file.kind === 'vue' || ctx.file.ext === '.vue'
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, (tpl) =>
      migrateHtmlTemplate(tpl)
    )
    if (result.changes.length && result.content !== ctx.file.content) {
      ctx.setContent(result.content, 'migrate-html')
      ctx.report({
        level: 'info',
        plugin: 'migrate-html',
        message: 'html rewrites ×' + result.changes.length,
      })
    }
    const filterNames = (result.meta && result.meta.filterNames) || []
    if (filterNames.length) {
      addFiltersHandoff(ctx.project, ctx.file.path, filterNames)
      ctx.report({
        level: 'info',
        plugin: 'migrate-html',
        message: 'handoff filterstomethods: ' + filterNames.join(', '),
      })
    }
  },
  async teardown(project) {
    flushHandoff(project)
  },
})

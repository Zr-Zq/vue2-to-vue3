const { createPlugin } = require('../create-plugin')
const { migrateHtmlTemplate } = require('../../transform/html-directives')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const { addFiltersHandoff, flushHandoff } = require('../../handoff')

/**
 * HTML 流：只改 template（sync / native / slot / v-for+v-if / keep-alive / |filter→调用）
 * filters→methods 属 JS 流；此处只写 .v23/handoff.json 交接项。
 */
module.exports = createPlugin({
  name: 'migrate-html',
  description: 'HTML 流：改写 template；filter 交接给 JS 流',
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
        message: 'html 改写 ×' + result.changes.length,
      })
    }
    const filterNames = (result.meta && result.meta.filterNames) || []
    if (filterNames.length) {
      addFiltersHandoff(ctx.project, ctx.file.path, filterNames)
      ctx.report({
        level: 'info',
        plugin: 'migrate-html',
        message: 'handoff filters→methods: ' + filterNames.join(', '),
      })
    }
  },
  async teardown(project) {
    flushHandoff(project)
  },
})

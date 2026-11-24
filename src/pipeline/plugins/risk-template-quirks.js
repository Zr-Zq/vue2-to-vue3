const { createPlugin } = require('../create-plugin')
const { loadHtmlAnalysis, pushHtmlFindings } = require('../risk/helpers')

/**
 * HTML（template）风险：统一走 analyze-html，不再手写散落正则。
 * 覆盖：v-for+v-if、filters、.native、.sync、动态参数、旧 slot、functional 等。
 */
module.exports = createPlugin({
  name: 'risk-template-quirks',
  description: 'HTML/template 迁移风险（统一 html 分析）',
  version: '0.2.0',
  match(ctx) {
    return ctx.file.kind === 'vue' || ctx.file.ext === '.vue'
  },
  async transform(ctx, api) {
    const analysis = loadHtmlAnalysis(ctx)
    if (!analysis || analysis.missing) return

    // keepalive 相关由 risk-keepalive-combo 做组合判断；这里跳过纯 info 的 keep-alive / :is 单点
    const filtered = Object.assign({}, analysis, {
      findings: (analysis.findings || []).filter((f) => {
        if (f.id === 'html.keep-alive') return false
        if (f.id === 'html.component-is') return false
        if (f.id === 'html.is-attr') return false
        return true
      }),
    })

    const n = pushHtmlFindings(api.project, filtered, ctx.file.path)
    if (n > 0) {
      ctx.report({
        level: 'info',
        plugin: 'risk-template-quirks',
        message: 'html findings ×' + n,
      })
    }

    // 摘要挂到 meta，供后续插件/报告
    if (!api.project.shared.htmlSummaries) api.project.shared.htmlSummaries = Object.create(null)
    api.project.shared.htmlSummaries[ctx.file.path] = analysis.summary
  },
})

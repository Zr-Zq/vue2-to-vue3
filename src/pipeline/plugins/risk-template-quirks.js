const { createPlugin } = require('../create-plugin')
const { loadHtmlAnalysis, pushHtmlFindings } = require('../risk/helpers')

/**
 * HTML (template) risks: unify via analyze-html; no scattered hand-written regex.
 * Covers: v-for+v-if, filters, .native, .sync, dynamic args, legacy slot, functional, etc.
 */
module.exports = createPlugin({
  name: 'risk-template-quirks',
  description: 'HTML/template migration risks (unified html analysis)',
  version: '0.2.0',
  match(ctx) {
    return ctx.file.kind === 'vue' || ctx.file.ext === '.vue'
  },
  async transform(ctx, api) {
    const analysis = loadHtmlAnalysis(ctx)
    if (!analysis || analysis.missing) return

    // keep-alive combos handled by risk-keepalive-combo; skip info-only keep-alive / :is singles here
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

    // Attach summary on meta for later plugins / reports
    if (!api.project.shared.htmlSummaries) api.project.shared.htmlSummaries = Object.create(null)
    api.project.shared.htmlSummaries[ctx.file.path] = analysis.summary
  },
})

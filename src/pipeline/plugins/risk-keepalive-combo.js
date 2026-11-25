const { createPlugin } = require('../create-plugin')
const { loadHtmlAnalysis, pushRisk } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-keepalive-combo',
  description: 'From HTML analysis: keep-alive with :is / async components',
  version: '0.2.0',
  match(ctx) {
    return ctx.file.kind === 'vue' || ctx.file.ext === '.vue'
  },
  async transform(ctx, api) {
    const analysis = loadHtmlAnalysis(ctx)
    if (!analysis || analysis.missing) return

    const ids = new Set((analysis.findings || []).map((f) => f.id))
    const hasKeep = ids.has('html.keep-alive')
    const hasIs = ids.has('html.component-is') || ids.has('html.is-attr')

    // Async clues are still inspected on the script (whole-file) side
    const src = ctx.file.content || ''
    const hasAsyncHint =
      /\(\)\s*=>\s*import\s*\(/.test(src) ||
      /component:\s*\(\)\s*=>/.test(src) ||
      /AsyncComponent|loading:\s*|delay:\s*/.test(src)

    const keepLoc = ((analysis.findings || []).find((f) => f.id === 'html.keep-alive') || {}).loc

    // keep-alive + :is: scripts add :key to treated as auto, not a risk
    if (hasKeep && hasIs) {
      pushRisk(api.project, {
        id: 'keepalive.is',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: 'keep-alive with dynamic :is (script adds :key)',
        hint: 'Handled deterministically by migrate-html',
        loc: keepLoc || null,
        part: 'html',
      })
    }
    // Async-only clues still suggest regression, but do not mark block
    if (hasKeep && hasAsyncHint) {
      pushRisk(api.project, {
        id: 'keepalive.async',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: 'keep-alive and async-component clues in same file (script can fix structure)',
        hint: 'Structure scripted; regress runtime cache behavior',
        loc: keepLoc || null,
        part: 'html',
      })
    }
  },
})

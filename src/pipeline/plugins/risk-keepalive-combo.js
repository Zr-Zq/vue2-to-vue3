const { createPlugin } = require('../create-plugin')
const { loadHtmlAnalysis, pushRisk } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-keepalive-combo',
  description: '基于 HTML 分析：keep-alive 与 :is / 异步组件组合',
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

    // 异步线索仍在 script（整文件）侧看
    const src = ctx.file.content || ''
    const hasAsyncHint =
      /\(\)\s*=>\s*import\s*\(/.test(src) ||
      /component:\s*\(\)\s*=>/.test(src) ||
      /AsyncComponent|loading:\s*|delay:\s*/.test(src)

    const keepLoc = ((analysis.findings || []).find((f) => f.id === 'html.keep-alive') || {}).loc

    // keep-alive + :is：脚本会补 :key，视为可自动、非危险
    if (hasKeep && hasIs) {
      pushRisk(api.project, {
        id: 'keepalive.is',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: 'keep-alive 与动态 :is（脚本补 :key）',
        hint: '已由 migrate-html 确定性处理',
        loc: keepLoc || null,
        part: 'html',
      })
    }
    // 仅异步线索仍提示回归，但不标 block
    if (hasKeep && hasAsyncHint) {
      pushRisk(api.project, {
        id: 'keepalive.async',
        category: 'keepalive-combo',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: 'keep-alive 与异步组件线索同文件（脚本可处理结构）',
        hint: '结构已脚本化；运行时缓存行为建议回归',
        loc: keepLoc || null,
        part: 'html',
      })
    }
  },
})

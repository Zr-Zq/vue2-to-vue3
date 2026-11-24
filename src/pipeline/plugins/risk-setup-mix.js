const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, hasOptionKey } = require('../risk/helpers')

const OPTION_KEYS = ['data', 'methods', 'computed', 'watch', 'mixins', 'props', 'components']

module.exports = createPlugin({
  name: 'risk-setup-mix',
  description: '检出 setup 与 Options API 混用',
  version: '0.1.0',
  match(ctx) {
    return ctx.file.kind === 'vue' || /setup\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    const scripts = loadScripts(ctx)
    const hasScriptSetup = scripts.some((s) => s.setup)
    const optionHits = new Set()
    let hasSetupFn = false

    scripts.forEach((script) => {
      if (hasOptionKey(script.ast, 'setup')) hasSetupFn = true
      OPTION_KEYS.forEach((k) => {
        if (hasOptionKey(script.ast, k)) optionHits.add(k)
      })
    })

    if ((hasSetupFn || hasScriptSetup) && optionHits.size) {
      pushRisk(api.project, {
        id: 'setup-mix',
        category: 'setup-mix',
        level: 'warn',
        auto: 'partial',
        file: ctx.file.path,
        message:
          'setup 与 Options 混用（' +
          Array.from(optionHits).join(',') +
          (hasScriptSetup ? ',script-setup' : '') +
          '）',
        evidence: Array.from(optionHits).join(','),
        hint: '需约定迁移策略：继续混用兼容 或 全 Composition',
      })
    } else if (hasSetupFn || hasScriptSetup) {
      pushRisk(api.project, {
        id: 'setup-only',
        category: 'setup-mix',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: hasScriptSetup ? '使用 script setup' : '使用 setup()（未见 Options 混用）',
      })
    }
  },
})

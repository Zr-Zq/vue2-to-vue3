const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, hasOptionKey } = require('../risk/helpers')

const OPTION_KEYS = ['data', 'methods', 'computed', 'watch', 'mixins', 'props', 'components']

module.exports = createPlugin({
  name: 'risk-setup-mix',
  description: 'Detect setup mixed with Options API',
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
          'setup mixed with Options (' +
          Array.from(optionHits).join(',') +
          (hasScriptSetup ? ',script-setup' : '') +
          '）',
        evidence: Array.from(optionHits).join(','),
        hint: 'Decide strategy: keep mixed compat or full Composition',
      })
    } else if (hasSetupFn || hasScriptSetup) {
      pushRisk(api.project, {
        id: 'setup-only',
        category: 'setup-mix',
        level: 'info',
        auto: 'yes',
        file: ctx.file.path,
        message: hasScriptSetup ? 'uses script setup' : 'uses setup() (no Options mix seen)',
      })
    }
  },
})

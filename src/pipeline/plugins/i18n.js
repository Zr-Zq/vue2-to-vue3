const { createPlugin } = require('../create-plugin')

/**
 * vue-i18n migration plugin slot.
 * Owns this.$i18n / this.$t / this.$tc / this.$te / this.$d / this.$n (not options-composition).
 */
module.exports = createPlugin({
  name: 'i18n',
  description: 'vue-i18n migration (pluggable); owns $i18n/$t/$tc/…',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const c = ctx.file.content
    return (
      /from\s+['"]vue-i18n['"]/.test(c) ||
      /require\(['"]vue-i18n['"]\)/.test(c) ||
      /new\s+VueI18n\b|createI18n\s*\(/.test(c) ||
      /\$i18n\b|\$t\b|\$tc\b|\$te\b|\$d\b|\$n\b/.test(c) ||
      /Vue\.use\s*\(\s*VueI18n\s*\)/.test(c)
    )
  },
  async transform(ctx, api) {
    const hits = []
    if (/from\s+['"]vue-i18n['"]/.test(ctx.file.content)) hits.push('import-vue-i18n')
    if (/new\s+VueI18n\b/.test(ctx.file.content)) hits.push('new VueI18n')
    if (/createI18n\s*\(/.test(ctx.file.content)) hits.push('createI18n')
    if (/\$i18n\b/.test(ctx.file.content)) hits.push('$i18n')
    if (/\$t\b/.test(ctx.file.content)) hits.push('$t')
    if (/\$tc\b/.test(ctx.file.content)) hits.push('$tc')
    if (/Vue\.use\s*\(\s*VueI18n\s*\)/.test(ctx.file.content)) hits.push('Vue.use(VueI18n)')

    ctx.report({
      level: hits.includes('new VueI18n') ? 'warn' : 'info',
      plugin: 'i18n',
      message: 'i18n: ' + (hits.join(', ') || 'usage'),
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=i18n */')) {
      ctx.setContent('/* v23:plugin=i18n */\n' + ctx.file.content, 'i18n')
    }
  },
})

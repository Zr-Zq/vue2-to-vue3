const { createPlugin } = require('../create-plugin')

/**
 * Vuex → compat / Pinia migration plugin slot.
 * Owns this.$store / mapState|mapGetters|mapMutations|mapActions
 * (options-composition leaves them alone).
 */
module.exports = createPlugin({
  name: 'vuex',
  description: 'Vuex usage detect and migrate (pluggable)',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const c = ctx.file.content
    return (
      /from\s+['"]vuex['"]/.test(c) ||
      /require\(['"]vuex['"]\)/.test(c) ||
      /\bmapState\b|\bmapGetters\b|\bmapMutations\b|\bmapActions\b|\bcreateStore\b|\bnew\s+Vuex\.Store\b/.test(
        c
      ) ||
      /\$store\b/.test(c)
    )
  },
  async transform(ctx, api) {
    const hits = []
    if (/from\s+['"]vuex['"]/.test(ctx.file.content)) hits.push('import-vuex')
    if (/new\s+Vuex\.Store|createStore\s*\(/.test(ctx.file.content)) hits.push('store-create')
    if (/\bmapState\b|\bmapGetters\b|\bmapMutations\b|\bmapActions\b/.test(ctx.file.content)) {
      hits.push('map-helpers')
    }
    if (/\$store\b/.test(ctx.file.content)) hits.push('$store')
    if (/Vue\.use\s*\(\s*Vuex\s*\)/.test(ctx.file.content)) hits.push('Vue.use(Vuex)')

    ctx.report({
      level: 'info',
      plugin: 'vuex',
      message: 'Vuex: ' + (hits.join(', ') || 'usage'),
    })

    // Can use preflight graph: who registered Vue.use(Vuex)
    const reg = api.lookup && api.lookup('Vuex')
    if (reg && reg.globals && reg.globals.length) {
      ctx.report({
        level: 'info',
        plugin: 'vuex',
        message:
          'Global registration hits Vuex: ' +
          reg.globals
            .map((g) => g.registrations.map((r) => r.file).join(','))
            .join('; '),
      })
    }

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=vuex */')) {
      ctx.setContent('/* v23:plugin=vuex */\n' + ctx.file.content, 'vuex')
    }
  },
})

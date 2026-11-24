const { createPlugin } = require('../create-plugin')

/**
 * Vuex → 兼容/Pinia 迁移插件位
 */
module.exports = createPlugin({
  name: 'vuex',
  description: 'Vuex 用法检测与迁移（可插拔）',
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

    // 可借助前置图：谁注册了 Vue.use(Vuex)
    const reg = api.lookup && api.lookup('Vuex')
    if (reg && reg.globals && reg.globals.length) {
      ctx.report({
        level: 'info',
        plugin: 'vuex',
        message:
          '全局登记命中 Vuex: ' +
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

const { createPlugin } = require('../create-plugin')

/**
 * Vue Router 3 → 4 plugin slot.
 */
module.exports = createPlugin({
  name: 'router',
  description: 'Vue Router migration (pluggable)',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const c = ctx.file.content
    return (
      /from\s+['"]vue-router['"]/.test(c) ||
      /new\s+VueRouter\b|createRouter\s*\(/.test(c) ||
      /mode:\s*['"]history['"]|mode:\s*['"]hash['"]/.test(c) ||
      /\$router\b|\$route\b/.test(c) ||
      /\brouter-view\b|\brouter-link\b/.test(c)
    )
  },
  async transform(ctx, api) {
    const hits = []
    if (/from\s+['"]vue-router['"]/.test(ctx.file.content)) hits.push('import-vue-router')
    if (/new\s+VueRouter\b/.test(ctx.file.content)) hits.push('new VueRouter')
    if (/mode:\s*['"]history['"]/.test(ctx.file.content)) hits.push('mode:history→createWebHistory')
    if (/mode:\s*['"]hash['"]/.test(ctx.file.content)) hits.push('mode:hash→createWebHashHistory')
    if (/Vue\.use\s*\(\s*VueRouter\s*\)/.test(ctx.file.content)) hits.push('Vue.use(VueRouter)')
    if (/\$router\.push|\$route\b/.test(ctx.file.content)) hits.push('instance-api')

    ctx.report({
      level: hits.includes('new VueRouter') || hits.some((h) => h.includes('mode:')) ? 'warn' : 'info',
      plugin: 'router',
      message: 'Router: ' + (hits.join(', ') || 'usage'),
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=router */')) {
      ctx.setContent('/* v23:plugin=router */\n' + ctx.file.content, 'router')
    }
  },
})

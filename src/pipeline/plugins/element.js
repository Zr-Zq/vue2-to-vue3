const { createPlugin } = require('../create-plugin')

/**
 * ElementUI to Element Plus plugin slot.
 */
module.exports = createPlugin({
  name: 'element',
  description: 'Element UI to Element Plus (pluggable)',
  version: '0.1.0',
  defaults: {
    mode: 'detect',
    packageFrom: 'element-ui',
    packageTo: 'element-plus',
  },
  match(ctx) {
    const c = ctx.file.content
    const from = 'element-ui'
    return (
      new RegExp(`from\\s+['"]${from}['"]`).test(c) ||
      c.includes('element-ui/') ||
      /Vue\.use\s*\(\s*ElementUI\s*/.test(c) ||
      /<el-[a-z]/.test(c) ||
      /\bMessage\b|\bMessageBox\b|\bNotification\b|\bLoading\.service\b/.test(c)
    )
  },
  async transform(ctx, api) {
    const hits = []
    if (/from\s+['"]element-ui['"]/.test(ctx.file.content)) hits.push('import-element-ui')
    if (/element-ui\//.test(ctx.file.content)) hits.push('element-ui/path')
    if (/Vue\.use\s*\(\s*ElementUI/.test(ctx.file.content)) hits.push('Vue.use(ElementUI)')
    if (/<el-[a-z]/.test(ctx.file.content)) hits.push('el-* templates')
    if (/MessageBox|\$message|\$confirm|\$loading/.test(ctx.file.content)) hits.push('service-api')
    if (/size:\s*['"]medium['"]/.test(ctx.file.content)) hits.push('size:mediumtodefault')

    ctx.report({
      level: hits.length ? 'warn' : 'info',
      plugin: 'element',
      message: 'Element: ' + (hits.join(', ') || 'usage'),
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=element */')) {
      ctx.setContent('/* v23:plugin=element */\n' + ctx.file.content, 'element')
    }
  },
})

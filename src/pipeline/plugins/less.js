const { createPlugin } = require('../create-plugin')

module.exports = createPlugin({
  name: 'less',
  description: 'Less / lang="less" handling (pluggable)',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const f = ctx.file
    if (f.ext === '.less') return true
    if (f.kind === 'vue' && /lang\s*=\s*["']less["']/i.test(f.content)) return true
    return /\.less['"]/.test(f.content)
  },
  async transform(ctx, api) {
    const hits = []
    if (/lang\s*=\s*["']less["']/i.test(ctx.file.content)) hits.push('lang=less')
    if (ctx.file.ext === '.less') hits.push('less-file')
    if (/@import\s+/.test(ctx.file.content) && ctx.file.ext === '.less') hits.push('less-import')

    ctx.report({
      level: 'info',
      plugin: 'less',
      message: hits.length ? 'Less: ' + hits.join(', ') : 'Less related files',
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=less */')) {
      ctx.setContent('/* v23:plugin=less */\n' + ctx.file.content, 'less')
    }
  },
})

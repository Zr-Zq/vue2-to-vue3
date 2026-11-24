const { createPlugin } = require('../create-plugin')

/**
 * SCSS 处理插件位：lang=scss / .scss / deep 选择器
 * mode: detect | annotate
 */
module.exports = createPlugin({
  name: 'scss',
  description: 'SCSS / lang="scss" 处理（可插拔）',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const f = ctx.file
    if (f.ext === '.scss' || f.ext === '.sass') return true
    if (f.kind === 'vue' && /lang\s*=\s*["']scss["']/i.test(f.content)) return true
    return /\.scss['"]/.test(f.content)
  },
  async transform(ctx, api) {
    const hits = []
    if (/::v-deep|\/deep\/|>>>|:deep\(/.test(ctx.file.content)) hits.push('deep-selector')
    if (/lang\s*=\s*["']scss["']/i.test(ctx.file.content)) hits.push('lang=scss')
    if (ctx.file.ext === '.scss' || ctx.file.ext === '.sass') hits.push('scss-file')

    ctx.report({
      level: 'info',
      plugin: 'scss',
      message: hits.length ? 'SCSS: ' + hits.join(', ') : 'SCSS 相关文件',
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=scss */')) {
      ctx.setContent('/* v23:plugin=scss */\n' + ctx.file.content, 'scss')
    }
  },
})

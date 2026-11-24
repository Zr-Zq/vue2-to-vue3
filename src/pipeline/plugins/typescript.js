const { createPlugin } = require('../create-plugin')

module.exports = createPlugin({
  name: 'typescript',
  description: 'TypeScript / lang="ts" handling (pluggable)',
  version: '0.1.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const f = ctx.file
    if (f.ext === '.ts' || f.ext === '.tsx') return true
    if (f.kind === 'vue' && /lang\s*=\s*["']tsx?["']/i.test(f.content)) return true
    return false
  },
  async transform(ctx, api) {
    const hits = []
    if (/lang\s*=\s*["']tsx?["']/i.test(ctx.file.content)) hits.push('lang=ts')
    if (ctx.file.ext === '.ts' || ctx.file.ext === '.tsx') hits.push('ts-file')
    if (/vue-property-decorator|vue-class-component|@Component/.test(ctx.file.content)) {
      hits.push('class-component')
    }

    ctx.report({
      level: hits.includes('class-component') ? 'warn' : 'info',
      plugin: 'typescript',
      message: hits.length ? 'TS: ' + hits.join(', ') : 'TS related files',
    })

    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=typescript */')) {
      ctx.setContent('/* v23:plugin=typescript */\n' + ctx.file.content, 'typescript')
    }
  },
})

const { createPlugin } = require('../../src/pipeline/create-plugin')

/**
 * 外部热插拔示例：在 pipeline 配置里
 * { use: './examples/plugins/hello-plugin.js', options: { banner: 'hi' } }
 */
module.exports = createPlugin({
  name: 'hello',
  description: '示例外部插件',
  version: '0.0.1',
  defaults: { banner: 'hello-from-external-plugin' },
  match(ctx) {
    return ctx.file.path === 'src/main.js'
  },
  async transform(ctx, api) {
    ctx.report({
      level: 'info',
      plugin: 'hello',
      message: 'hello touched main.js · ' + api.options.banner,
    })
    if (api.options.mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=hello */')) {
      ctx.setContent('/* v23:plugin=hello */\n' + ctx.file.content, 'hello')
    }
  },
})

const { createPlugin } = require('../../src/pipeline/create-plugin')

/**
 * External hot-plug example: in pipeline config
 * { use: './examples/plugins/hello-plugin.js', options: { banner: 'hi' } }
 */
module.exports = createPlugin({
  name: 'hello',
  description: 'Example external plugin',
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

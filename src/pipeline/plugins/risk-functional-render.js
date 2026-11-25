const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, hasOptionKey, locOf, traverse, t } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-functional-render',
  description: 'Detect options.functional and render(h) (template functional via html analysis)',
  version: '0.2.0',
  match(ctx) {
    return (
      ctx.file.kind === 'vue' ||
      ctx.file.kind === 'js' ||
      /\.(vue|js|jsx|ts|tsx)$/.test(ctx.file.ext) ||
      /functional\s*:|render\s*\(/.test(ctx.file.content)
    )
  },
  async transform(ctx, api) {
    // <template functional> is handled by risk-template-quirks / analyze-html
    loadScripts(ctx).forEach((script) => {
      if (hasOptionKey(script.ast, 'functional')) {
        pushRisk(api.project, {
          id: 'functional.option',
          category: 'functional',
          level: 'info',
          auto: 'yes',
          file: ctx.file.path,
          message: 'options.functional = true (script to normal component)',
          hint: 'Handled deterministically by migrate-functional',
        })
      }

      traverse(script.ast, {
        ObjectMethod(p) {
          if (t.isIdentifier(p.node.key, { name: 'render' })) {
            pushRisk(api.project, {
              id: 'render.method',
              category: 'render-h',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'Hand-written render (script drops h / flattens data / $slots)',
              loc: locOf(p.node.key),
              hint: 'Handled deterministically by migrate-render-h',
            })
          }
        },
        ObjectProperty(p) {
          if (
            t.isIdentifier(p.node.key, { name: 'render' }) &&
            (t.isFunctionExpression(p.node.value) || t.isArrowFunctionExpression(p.node.value))
          ) {
            pushRisk(api.project, {
              id: 'render.property',
              category: 'render-h',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'Hand-written render function (script can rewrite)',
              loc: locOf(p.node.key),
              hint: 'Handled deterministically by migrate-render-h',
            })
          }
        },
      })
    })
  },
})

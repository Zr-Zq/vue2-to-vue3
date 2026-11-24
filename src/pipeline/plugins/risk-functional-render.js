const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, hasOptionKey, locOf, traverse, t } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-functional-render',
  description: '检出 options.functional 与 render(h)（template functional 由 html 分析负责）',
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
    // <template functional> 已在 risk-template-quirks / analyze-html 处理
    loadScripts(ctx).forEach((script) => {
      if (hasOptionKey(script.ast, 'functional')) {
        pushRisk(api.project, {
          id: 'functional.option',
          category: 'functional',
          level: 'info',
          auto: 'yes',
          file: ctx.file.path,
          message: 'options.functional = true（脚本改为普通组件）',
          hint: '已由 migrate-functional 确定性处理',
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
              message: '手写 render（脚本去 h 参 / 拍平 data / $slots）',
              loc: locOf(p.node.key),
              hint: '已由 migrate-render-h 确定性处理',
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
              message: '手写 render 函数（脚本可改）',
              loc: locOf(p.node.key),
              hint: '已由 migrate-render-h 确定性处理',
            })
          }
        },
      })
    })
  },
})

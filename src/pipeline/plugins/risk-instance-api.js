const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, thisMemberChain, locOf, traverse, t } = require('../risk/helpers')

const WATCH = new Set(['$parent', '$children', '$root', '$listeners', '$scopedSlots'])

module.exports = createPlugin({
  name: 'risk-instance-api',
  description: '检出 this.$parent/$children/$root/$listeners/$scopedSlots',
  version: '0.1.0',
  match(ctx) {
    return /\.(vue|js|jsx|ts|tsx|mjs|cjs)$/.test(ctx.file.ext) || ctx.file.kind === 'vue'
  },
  async transform(ctx, api) {
    loadScripts(ctx).forEach((script) => {
      traverse(script.ast, {
        MemberExpression(p) {
          const chain = thisMemberChain(p.node)
          if (!chain || !chain.length) return
          const head = chain[0]
          if (!WATCH.has(head)) return
          // 只记读取/调用的根 API
          const scripted =
            head === '$listeners' || head === '$scopedSlots' || head === '$children'
          pushRisk(api.project, {
            id: 'instance-api.' + head,
            category: 'instance-api',
            level: head === '$parent' || head === '$root' ? 'block' : scripted ? 'info' : 'warn',
            auto: scripted ? 'yes' : 'no',
            file: ctx.file.path,
            message: '使用实例 API this.' + chain.join('.'),
            loc: locOf(p.node),
            evidence: 'this.' + chain.join('.'),
            hint: scripted
              ? '已由 migrate-api-compat / migrate-children 脚本处理'
              : '运行时组件树依赖，不宜盲改',
          })
          p.skip()
        },
      })
    })
  },
})

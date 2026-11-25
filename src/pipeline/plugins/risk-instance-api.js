const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, thisMemberChain, locOf, traverse, t } = require('../risk/helpers')

const WATCH = new Set(['$parent', '$children', '$root', '$listeners', '$scopedSlots'])

module.exports = createPlugin({
  name: 'risk-instance-api',
  description: 'Detect this.$parent/$children/$root/$listeners/$scopedSlots',
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
          // $listeners/$scopedSlots → scripts; $parent/$children/$root → AI
          const scripted = head === '$listeners' || head === '$scopedSlots'
          const treeApi = head === '$parent' || head === '$children' || head === '$root'
          pushRisk(api.project, {
            id: 'instance-api.' + head,
            category: 'instance-api',
            level: treeApi ? 'block' : scripted ? 'info' : 'warn',
            auto: scripted ? 'yes' : 'no',
            file: ctx.file.path,
            message: 'Uses instance API this.' + chain.join('.'),
            loc: locOf(p.node),
            evidence: 'this.' + chain.join('.'),
            hint: scripted
              ? 'Handled by migrate-api-compat'
              : 'AI: keep behavior via provide/inject or explicit refs (scripts do not rewrite $parent/$children/$root)',
          })
          p.skip()
        },
      })
    })
  },
})

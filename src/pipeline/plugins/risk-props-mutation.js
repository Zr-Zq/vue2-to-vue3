const { createPlugin } = require('../create-plugin')
const {
  pushRisk,
  loadScripts,
  collectPropNames,
  thisMemberChain,
  locOf,
  traverse,
  t,
} = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-props-mutation',
  description: 'Detect assignment/mutation of props',
  version: '0.1.0',
  match(ctx) {
    return ctx.file.kind === 'vue' || /\.(js|jsx|ts|tsx)$/.test(ctx.file.ext)
  },
  async transform(ctx, api) {
    loadScripts(ctx).forEach((script) => {
      const propNames = collectPropNames(script.ast)
      if (!propNames.size) return

      traverse(script.ast, {
        AssignmentExpression(p) {
          const left = p.node.left
          const chain = thisMemberChain(left)
          if (!chain || !chain.length) return
          if (!propNames.has(chain[0])) return
          pushRisk(api.project, {
            id: 'props-mutation.assign',
            category: 'props-mutation',
            level: 'block',
            auto: 'partial',
            file: ctx.file.path,
            message: 'Suspected props mutation: this.' + chain.join('.'),
            loc: locOf(p.node),
            evidence: 'this.' + chain.join('.'),
            hint: 'Direct assignment detectable; aliases/destructuring may miss',
          })
        },
        UpdateExpression(p) {
          const chain = thisMemberChain(p.node.argument)
          if (!chain || !chain.length || !propNames.has(chain[0])) return
          pushRisk(api.project, {
            id: 'props-mutation.update',
            category: 'props-mutation',
            level: 'block',
            auto: 'partial',
            file: ctx.file.path,
            message: 'Suspected self-mutation of props: this.' + chain.join('.'),
            loc: locOf(p.node),
            evidence: 'this.' + chain.join('.'),
            hint: 'Child mutating props is a common Vue2 pitfall',
          })
        },
        CallExpression(p) {
          // this.$set(this.propObj, key, val) where propObj is a prop
          const callee = p.node.callee
          if (
            t.isMemberExpression(callee) &&
            t.isThisExpression(callee.object) &&
            t.isIdentifier(callee.property, { name: '$set' }) &&
            p.node.arguments[0]
          ) {
            const chain = thisMemberChain(p.node.arguments[0])
            if (chain && propNames.has(chain[0])) {
              pushRisk(api.project, {
                id: 'props-mutation.$set',
                category: 'props-mutation',
                level: 'warn',
                auto: 'partial',
                file: ctx.file.path,
                message: '$set target looks like props: this.' + chain.join('.'),
                loc: locOf(p.node),
                evidence: 'this.$set(this.' + chain.join('.') + ', …)',
              })
            }
          }
        },
      })
    })
  },
})

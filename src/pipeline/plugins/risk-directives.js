const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, locOf, traverse, t } = require('../risk/helpers')

const V2_HOOKS = new Set(['bind', 'inserted', 'update', 'componentUpdated', 'unbind'])

module.exports = createPlugin({
  name: 'risk-directives',
  description: 'Detect custom directives and Vue2 hook names',
  version: '0.1.0',
  match(ctx) {
    return /directives\s*:|Vue\.directive/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    loadScripts(ctx).forEach((script) => {
      traverse(script.ast, {
        ObjectProperty(p) {
          if (!t.isIdentifier(p.node.key, { name: 'directives' }) && !(t.isStringLiteral(p.node.key) && p.node.key.value === 'directives')) {
            return
          }
          const val = p.node.value
          if (!t.isObjectExpression(val)) return
          val.properties.forEach((prop) => {
            if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
            const dname = t.isIdentifier(prop.key)
              ? prop.key.name
              : t.isStringLiteral(prop.key)
                ? prop.key.value
                : '?'
            const hooks = []
            const body = t.isObjectMethod(prop) ? null : prop.value
            if (t.isObjectExpression(body)) {
              body.properties.forEach((hp) => {
                const hk = t.isIdentifier(hp.key)
                  ? hp.key.name
                  : t.isStringLiteral(hp.key)
                    ? hp.key.value
                    : null
                if (hk && V2_HOOKS.has(hk)) hooks.push(hk)
              })
            }
            pushRisk(api.project, {
              id: 'directive.local',
              category: 'directive',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'local directive ' + dname + (hooks.length ? ' hooks: ' + hooks.join(',') : ''),
              loc: locOf(prop),
              evidence: dname,
              hint: 'Hook names mapped by migrate-directive-hooks',
            })
          })
        },
        CallExpression(p) {
          const callee = p.node.callee
          if (
            t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: 'Vue' }) &&
            t.isIdentifier(callee.property, { name: 'directive' })
          ) {
            const nameArg = p.node.arguments[0]
            const name = t.isStringLiteral(nameArg) ? nameArg.value : '<expr>'
            pushRisk(api.project, {
              id: 'directive.global',
              category: 'directive',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'global Vue.directive(' + name + ') (hook names can be script-mapped)',
              loc: locOf(p.node),
              evidence: 'Vue.directive',
              hint: 'Still registered via Vue.directive; move to app.directive needs entry changes',
            })
          }
        },
      })
    })
  },
})

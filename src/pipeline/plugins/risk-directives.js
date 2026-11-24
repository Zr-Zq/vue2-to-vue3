const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, locOf, traverse, t } = require('../risk/helpers')

const V2_HOOKS = new Set(['bind', 'inserted', 'update', 'componentUpdated', 'unbind'])

module.exports = createPlugin({
  name: 'risk-directives',
  description: '检出自定义指令及 Vue2 钩子名',
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
              message: '本地指令 ' + dname + (hooks.length ? ' 钩子: ' + hooks.join(',') : ''),
              loc: locOf(prop),
              evidence: dname,
              hint: '钩子名已由 migrate-directive-hooks 映射',
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
              message: '全局 Vue.directive(' + name + ')（钩子名可脚本映射）',
              loc: locOf(p.node),
              evidence: 'Vue.directive',
              hint: '登记仍在 Vue.directive；挂到 app.directive 需入口改造',
            })
          }
        },
      })
    })
  },
})

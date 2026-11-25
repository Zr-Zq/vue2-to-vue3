const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, locOf, traverse, t } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-globals-extend',
  description: 'Detect Vue.extend / manual $mount / Vue.mixin / Vue.config',
  version: '0.1.0',
  match(ctx) {
    return /Vue\.(extend|mixin|config)|\$mount\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    // If the graph already has global registrations, attach references
    const g = api.project.graph
    if (g && g.globalIndex) {
      g.globalIndex.forEach((item) => {
        if (!item.registrations.some((r) => r.file === ctx.file.path)) return
        if (
          item.kind === 'vue.mixin' ||
          item.kind === 'vue.config' ||
          item.kind === 'vue.extend' ||
          item.kind === 'vue.prototype'
        ) {
          // vue.extend already handled by migrate-extend; not treated as a risk
          if (item.kind === 'vue.extend') {
            pushRisk(api.project, {
              id: 'globals.' + item.kind,
              category: 'vue-extend-mount',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'Global Vue.extend (script to defineComponent)',
              evidence: item.api,
              hint: 'Handled deterministically by migrate-extend',
            })
            return
          }
          pushRisk(api.project, {
            id: 'globals.' + item.kind,
            category: 'global-side-effect',
            level: item.kind === 'vue.mixin' ? 'block' : 'warn',
            auto: item.kind === 'vue.prototype' ? 'partial' : 'no',
            file: ctx.file.path,
            message: 'Global side-effect registration: ' + item.api,
            evidence: item.api,
            hint: 'From preflight graph; migrate to app-level APIs',
          })
        }
      })
    }

    loadScripts(ctx).forEach((script) => {
      traverse(script.ast, {
        CallExpression(p) {
          const callee = p.node.callee
          if (
            t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: 'Vue' }) &&
            t.isIdentifier(callee.property, { name: 'extend' })
          ) {
            pushRisk(api.project, {
              id: 'vue.extend',
              category: 'vue-extend-mount',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'Vue.extend(...) (script to defineComponent)',
              loc: locOf(p.node),
              hint: 'Handled deterministically by migrate-extend',
            })
          }
          if (
            t.isMemberExpression(callee) &&
            t.isIdentifier(callee.property, { name: '$mount' })
          ) {
            pushRisk(api.project, {
              id: 'manual.$mount',
              category: 'vue-extend-mount',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: 'Manual $mount() (script to createApp().mount)',
              loc: locOf(p.node),
              hint: 'Handled deterministically by migrate-mount',
            })
          }
        },
      })
    })
  },
})

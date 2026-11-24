const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, locOf, traverse, t } = require('../risk/helpers')

module.exports = createPlugin({
  name: 'risk-globals-extend',
  description: '检出 Vue.extend / 手动 $mount / Vue.mixin / Vue.config',
  version: '0.1.0',
  match(ctx) {
    return /Vue\.(extend|mixin|config)|\$mount\s*\(/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    // 若图里已有全局登记，附加引用
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
          // vue.extend 已由 migrate-extend 脚本处理，不进危险侧
          if (item.kind === 'vue.extend') {
            pushRisk(api.project, {
              id: 'globals.' + item.kind,
              category: 'vue-extend-mount',
              level: 'info',
              auto: 'yes',
              file: ctx.file.path,
              message: '全局登记 Vue.extend（脚本 → defineComponent）',
              evidence: item.api,
              hint: '已由 migrate-extend 确定性处理',
            })
            return
          }
          pushRisk(api.project, {
            id: 'globals.' + item.kind,
            category: 'global-side-effect',
            level: item.kind === 'vue.mixin' ? 'block' : 'warn',
            auto: item.kind === 'vue.prototype' ? 'partial' : 'no',
            file: ctx.file.path,
            message: '全局副作用登记: ' + item.api,
            evidence: item.api,
            hint: '来自前置 graph；迁移需改 app 级 API',
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
              message: 'Vue.extend(...)（脚本 → defineComponent）',
              loc: locOf(p.node),
              hint: '已由 migrate-extend 确定性处理',
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
              message: '手动 $mount()（脚本 → createApp().mount）',
              loc: locOf(p.node),
              hint: '已由 migrate-mount 确定性处理',
            })
          }
        },
      })
    })
  },
})

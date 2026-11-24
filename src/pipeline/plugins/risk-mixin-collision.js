const { createPlugin } = require('../create-plugin')
const { pushRisk } = require('../risk/helpers')

/**
 * 依赖前置 graph.mixins：宿主与 mixin 成员同名冲突
 * 在 setup 阶段按图扫一次即可，match 只让入口文件跑避免重复——改用 setup 全局扫
 */
module.exports = createPlugin({
  name: 'risk-mixin-collision',
  description: 'mixin 与宿主同名成员冲突（依赖 graph）',
  version: '0.1.0',
  async setup(project) {
    const mixins = project.graph && project.graph.mixins
    if (!mixins || !mixins.memberIndex) return

    // 按应用文件聚合：该文件本地 mixin 注入的成员
    const byHost = Object.create(null)
    mixins.applications.forEach((app) => {
      if (!app.file) return
      if (!byHost[app.file]) byHost[app.file] = []
      byHost[app.file].push(app)
    })

    // 成员 → 多个 mixin 来源 或 与「同文件 options」冲突：先标「同成员被多个 mixin 提供」
    const nameHosts = Object.create(null)
    mixins.memberIndex.forEach((m) => {
      ;(m.appliedBy || []).forEach((a) => {
        const key = a.file + '::' + m.name
        if (!nameHosts[key]) nameHosts[key] = []
        nameHosts[key].push(m)
      })
    })

    Object.keys(nameHosts).forEach((key) => {
      const list = nameHosts[key]
      if (list.length < 2) return
      const file = key.split('::')[0]
      const name = key.split('::')[1]
      pushRisk(project, {
        id: 'mixin.multi-source',
        category: 'mixin-collision',
        level: 'warn',
        auto: 'partial',
        file,
        message: '成员 "' + name + '" 来自多个 mixin 应用路径',
        evidence: list.map((x) => x.mixinFile).join(' | '),
        hint: '合并优先级依赖 Vue2 mixin 策略，迁移需显式处理',
      })
    })

    // 全局 mixin 成员：全部标 block 提示
    mixins.memberIndex.forEach((m) => {
      if (!m.global) return
      pushRisk(project, {
        id: 'mixin.global-member',
        category: 'mixin-collision',
        level: 'block',
        auto: 'no',
        file: m.mixinFile,
        message: '全局 mixin 注入成员 "' + m.name + '" (' + m.section + ')',
        evidence: m.mixinFile,
        hint: '影响面大，应人工确认替代方案',
      })
    })
  },
  match() {
    return false // 仅 setup 扫图
  },
})

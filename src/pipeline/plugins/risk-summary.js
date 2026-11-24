const fs = require('fs')
const path = require('path')
const { createPlugin } = require('../create-plugin')
const { summarizeRisks, ensureRiskStore } = require('../risk/helpers')
const { ensureProjectWorkDir, projectWorkDir } = require('../../paths')

/** 不可完整自动处理的类别说明（给使用方的固定清单，写入报告） */
const CANNOT_FULLY_AUTO = [
  {
    category: 'instance-api',
    title: '$parent / $root 等实例树 API',
    reason:
      '依赖运行时组件树；$children/$listeners/$scopedSlots 已脚本处理，$parent/$root 仍需人工',
  },
  {
    category: 'props-mutation',
    title: '子组件修改 props（间接/别名）',
    reason: '解构、别名、透传后再改，静态会漏检',
  },
  {
    category: 'mixin-collision',
    title: 'mixin 同名合并优先级 / 全局 mixin 注入',
    reason: '合并策略与影响面需产品决策，不能盲合并',
  },
  {
    category: 'global-side-effect',
    title: 'Vue.mixin / Vue.config / Vue.prototype 全局副作用',
    reason:
      '需迁到 app 级 API；productionTip/silent 已脚本删除，mixin/prototype/keyCodes 仍需人工',
  },
  {
    category: 'setup-mix',
    title: 'setup 与 Options 混用策略',
    reason: '继续混用或全 Composition 是架构选择',
  },
  {
    category: 'provide-primitive',
    title: 'provide 原始类型不响应',
    reason: '包成 ref 会改变所有 inject 方的取值方式',
  },
]

module.exports = createPlugin({
  name: 'risk-summary',
  description: '汇总风险并写入 .v23/risks.json',
  version: '0.1.0',
  match() {
    return false
  },
  async teardown(project) {
    ensureRiskStore(project)
    const summary = summarizeRisks(project)
    const workDir = ensureProjectWorkDir(project.root)
    const out = {
      generatedAt: new Date().toISOString(),
      projectRoot: project.root,
      summary,
      cannotFullyAuto: CANNOT_FULLY_AUTO,
      risks: project.shared.risks || [],
    }
    const htmlRisks = (project.shared.risks || []).filter((r) => r.part === 'html')
    out.html = {
      riskCount: htmlRisks.length,
      summaries: project.shared.htmlSummaries || {},
    }

    const risksPath = path.join(workDir, 'risks.json')
    fs.writeFileSync(risksPath, JSON.stringify(out, null, 2), 'utf8')
    fs.writeFileSync(
      path.join(workDir, 'html-risks.json'),
      JSON.stringify(
        {
          generatedAt: out.generatedAt,
          projectRoot: project.root,
          total: htmlRisks.length,
          risks: htmlRisks,
          summaries: project.shared.htmlSummaries || {},
        },
        null,
        2
      ),
      'utf8'
    )

    // 给人看的短清单
    const md = []
    md.push('# Vue2→Vue3 前置风险报告')
    md.push('')
    md.push('- 总计: ' + summary.total)
    md.push('- 其中 HTML/template: ' + htmlRisks.length)
    md.push('- auto yes/partial/no: ' + summary.byAuto.yes + '/' + summary.byAuto.partial + '/' + summary.byAuto.no)
    md.push('')
    md.push('## 按类别')
    Object.keys(summary.byCategory)
      .sort()
      .forEach((k) => md.push('- ' + k + ': ' + summary.byCategory[k]))
    md.push('')
    md.push('## 无法完整自动处理（需你方方案）')
    CANNOT_FULLY_AUTO.forEach((c, i) => {
      md.push((i + 1) + '. **' + c.title + '** (`' + c.category + '`)')
      md.push('   - ' + c.reason)
    })
    fs.writeFileSync(path.join(workDir, 'risks-cannot-auto.md'), md.join('\n') + '\n', 'utf8')

    project.shared.risksReportPath = risksPath
    if (project.config && project.config.verbose) {
      console.log('[risk-summary] 写入', risksPath, 'total=', summary.total)
      console.log('[risk-summary] 工作目录', projectWorkDir(project.root))
    }
  },
})

module.exports.CANNOT_FULLY_AUTO = CANNOT_FULLY_AUTO

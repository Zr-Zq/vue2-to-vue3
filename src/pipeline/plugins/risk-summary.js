const fs = require('fs')
const path = require('path')
const { createPlugin } = require('../create-plugin')
const { summarizeRisks, ensureRiskStore } = require('../risk/helpers')
const { ensureProjectWorkDir, projectWorkDir } = require('../../paths')

/** Categories that cannot be fully automated (fixed list for consumers; written into the report) */
const CANNOT_FULLY_AUTO = [
  {
    category: 'v-for-v-if',
    title: 'Same-node v-for + v-if',
    reason:
      'Only same-element combo needs migration; AI chooses Vue3 shape (<template v-for :key> + inner v-if). Different-node v-for/v-if needs no change',
  },
  {
    category: 'instance-api',
    title: 'Instance tree APIs such as $parent / $root',
    reason:
      'Depends on the runtime component tree; $children/$listeners/$scopedSlots/$on/$off/$once are script-handled, $parent/$root still need humans',
  },
  {
    category: 'props-mutation',
    title: 'Child mutates props (indirect / aliases)',
    reason: 'Destructuring, aliases, and mutate-after-pass-through can be missed statically',
  },
  {
    category: 'mixin-collision',
    title: 'Mixin same-name merge priority / global mixin injection',
    reason: 'Merge strategy and blast radius need product decisions; do not merge blindly',
  },
  {
    category: 'global-side-effect',
    title: 'Vue.mixin / Vue.config / Vue.prototype global side effects',
    reason:
      'Move to app-level APIs; productionTip/silent already removed by scripts; mixin/prototype/keyCodes still need humans',
  },
  {
    category: 'setup-mix',
    title: 'setup mixed with Options strategy',
    reason: 'Keep mixing vs full Composition is an architecture choice',
  },
  {
    category: 'provide-primitive',
    title: 'provide of primitives is not reactive',
    reason: 'Wrapping in ref changes how every inject site reads the value',
  },
]

module.exports = createPlugin({
  name: 'risk-summary',
  description: 'Summarize risks and write .v23/risks.json',
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

    // Short human-readable checklist
    const md = []
    md.push('# Vue2→Vue3 preflight risk report')
    md.push('')
    md.push('- Total: ' + summary.total)
    md.push('- HTML/template: ' + htmlRisks.length)
    md.push('- auto yes/partial/no: ' + summary.byAuto.yes + '/' + summary.byAuto.partial + '/' + summary.byAuto.no)
    md.push('')
    md.push('## By category')
    Object.keys(summary.byCategory)
      .sort()
      .forEach((k) => md.push('- ' + k + ': ' + summary.byCategory[k]))
    md.push('')
    md.push('## Cannot fully automate (needs your plan)')
    CANNOT_FULLY_AUTO.forEach((c, i) => {
      md.push((i + 1) + '. **' + c.title + '** (`' + c.category + '`)')
      md.push('   - ' + c.reason)
    })
    fs.writeFileSync(path.join(workDir, 'risks-cannot-auto.md'), md.join('\n') + '\n', 'utf8')

    project.shared.risksReportPath = risksPath
    if (project.config && project.config.verbose) {
      console.log('[risk-summary] wrote', risksPath, 'total=', summary.total)
      console.log('[risk-summary] workDir', projectWorkDir(project.root))
    }
  },
})

module.exports.CANNOT_FULLY_AUTO = CANNOT_FULLY_AUTO

const { createPlugin } = require('../create-plugin')
const { loadScripts, ensureRiskStore } = require('../risk/helpers')
const { annotateContent, TAG } = require('../risk/annotate')

/**
 * 对已识别风险：不改逻辑，只插入
 *   /* 迁移脚本注释: AI-TODO [category] ... *\/
 * 或模板 <!-- 迁移脚本注释: AI-TODO ... -->
 * 交给 AI 后续处理。
 */
module.exports = createPlugin({
  name: 'risk-annotate',
  description: '给风险点打 AI-TODO 注释，不改业务逻辑',
  version: '0.1.0',
  defaults: {
    enabled: true,
  },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    const risks = (api.project.shared.risks || []).filter(
      (r) => r.file === ctx.file.path && r.auto !== 'yes'
    )
    return risks.length > 0
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    // auto=yes 的项已由脚本确定性处理，不再打 AI-TODO
    const risks = (api.project.shared.risks || []).filter(
      (r) => r.file === ctx.file.path && r.auto !== 'yes'
    )
    if (!risks.length) return

    const scripts = loadScripts(ctx)
    const result = annotateContent(ctx.file.content, risks, {
      kind: ctx.file.kind,
      absPath: ctx.file.absPath,
      scriptContents: scripts.map((s) => s.code).filter(Boolean),
    })

    if (result.inserted > 0 && result.content !== ctx.file.content) {
      ctx.setContent(result.content, 'risk-annotate')
      ctx.report({
        level: 'info',
        plugin: 'risk-annotate',
        message: '插入 AI-TODO 注释 ×' + result.inserted,
      })
    }
  },
  async teardown(project, api) {
    // setup 阶段产生的风险（如 mixin-collision）可能没有走过 transform：补一轮
    ensureRiskStore(project)
    const byFile = Object.create(null)
    ;(project.shared.risks || []).forEach((r) => {
      if (!r.file) return
      if (!byFile[r.file]) byFile[r.file] = []
      byFile[r.file].push(r)
    })

    // 仅统计；文件级已在 transform 处理。setup-only 风险若 file 指向 mixin 源文件，
    // 该文件若已被扫描过则已标注；未 match 到的在此无法再跑 fileCtx。
    project.shared.annotateTag = TAG
    if (api && api.log) api.log('risk-annotate teardown ok')
  },
})

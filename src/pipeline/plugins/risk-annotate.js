const { createPlugin } = require('../create-plugin')
const { loadScripts, ensureRiskStore } = require('../risk/helpers')
const { annotateContent, TAG } = require('../risk/annotate')

/**
 * For detected risks: do not change logic; only insert
 *   /* AI-TODO: [category] ... *\/
 * or in templates <!-- AI-TODO: ... -->
 * for AI follow-up.
 */
module.exports = createPlugin({
  name: 'risk-annotate',
  description: 'Annotate risks with AI-TODO; do not change business logic',
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
    // auto=yes items were handled deterministically by scripts; skip AI-TODO
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
        message: 'inserted AI-TODO comments ×' + result.inserted,
      })
    }
  },
  async teardown(project, api) {
    // Risks from setup (e.g. mixin-collision) may not have gone through transform: note only
    ensureRiskStore(project)
    const byFile = Object.create(null)
    ;(project.shared.risks || []).forEach((r) => {
      if (!r.file) return
      if (!byFile[r.file]) byFile[r.file] = []
      byFile[r.file].push(r)
    })

    // Stats only; per-file handled in transform. Setup-only risks whose file points at a
    // mixin source: already annotated if that file was scanned; unmatched cannot re-run fileCtx here.
    project.shared.annotateTag = TAG
    if (api && api.log) api.log('risk-annotate teardown ok')
  },
})

const { createPlugin } = require('../create-plugin')
const { migrateFiltersOption } = require('../../transform/js-filters-option')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const {
  pendingForFile,
  resolveHandoffItem,
  flushHandoff,
  ensureSharedHandoff,
} = require('../../handoff')

/**
 * JS stream: options.filters → methods.
 * Can run alone or consume HTML-stream handoff. Skip (no error) if filters not found.
 */
module.exports = createPlugin({
  name: 'migrate-filters',
  description: 'JS stream: options.filters → methods (consume HTML handoff; skip if missing)',
  version: '0.2.0',
  defaults: { enabled: true, stream: 'js' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    ensureSharedHandoff(ctx.project)
    const hasFiltersOpt = /filters\s*:/.test(ctx.file.content)
    const hasHandoff = pendingForFile(ctx.project, ctx.file.path, 'filters-to-methods').length > 0
    return hasFiltersOpt || hasHandoff
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const pending = pendingForFile(ctx.project, ctx.file.path, 'filters-to-methods')
    const expected = []
    pending.forEach((it) => (it.filters || []).forEach((n) => expected.push(n)))

    let changed = false
    let migratedNames = []

    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
        migrateFiltersOption(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      migratedNames = (result.changes || [])
        .filter((c) => c.kind === 'filters-to-methods' || c.kind === 'filters-rename-methods')
        .map((c) => c.name)
        .filter(Boolean)
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-filters')
        changed = true
        ctx.report({
          level: 'info',
          plugin: 'migrate-filters',
          message: 'filters→methods ×' + result.changes.length,
        })
      }
    } else {
      const result = migrateFiltersOption(ctx.file.content, ctx.file.absPath)
      migratedNames = (result.changes || [])
        .filter((c) => c.kind === 'filters-to-methods' || c.kind === 'filters-rename-methods')
        .map((c) => c.name)
        .filter(Boolean)
      if (result.changes.length && result.code !== ctx.file.content) {
        ctx.setContent(result.code, 'migrate-filters')
        changed = true
        ctx.report({
          level: 'info',
          plugin: 'migrate-filters',
          message: 'filters→methods ×' + result.changes.length,
        })
      }
    }

    if (pending.length) {
      if (changed || migratedNames.length) {
        resolveHandoffItem(ctx.project, {
          file: ctx.file.path,
          kind: 'filters-to-methods',
          status: 'done',
          note: 'filters merged into methods',
        })
      } else {
        // HTML handed off, but script has no filters (or already edited) → skip
        resolveHandoffItem(ctx.project, {
          file: ctx.file.path,
          kind: 'filters-to-methods',
          status: 'skipped',
          note:
            expected.length > 0
              ? 'JS side: options.filters not found (expected: ' + expected.join(', ') + '), skipped'
              : 'JS side: options.filters not found, skipped',
        })
        ctx.report({
          level: 'info',
          plugin: 'migrate-filters',
          message: 'handoff skipped: no filters option',
        })
        ctx.skip('migrate-filters', 'handoff-no-filters')
      }
    }
  },
  async teardown(project) {
    flushHandoff(project)
  },
})

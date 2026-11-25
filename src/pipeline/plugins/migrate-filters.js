const { createPlugin } = require('../create-plugin')
const { migrateFiltersOption } = require('../../transform/js-filters-option')
const { rewriteFilterCallAliases } = require('../../transform/html-filters')
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
 * On name collision with methods: keep method, store filter as __v23Filter_<name>,
 * and rewrite mustache / v-bind call sites in the same SFC.
 */
function collectRenames(changes) {
  const renames = Object.create(null)
  ;(changes || []).forEach((c) => {
    if (c && c.kind === 'filters-rename-dup' && c.from && c.to) renames[c.from] = c.to
  })
  return renames
}

module.exports = createPlugin({
  name: 'migrate-filters',
  description: 'JS stream: options.filters → methods (consume HTML handoff; skip if missing)',
  version: '0.3.0',
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
    let allChanges = []

    if (ctx.file.ext === '.vue') {
      const scriptResult = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
        migrateFiltersOption(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      allChanges = scriptResult.changes || []
      migratedNames = allChanges
        .filter(
          (c) =>
            c.kind === 'filters-to-methods' ||
            c.kind === 'filters-rename-methods' ||
            c.kind === 'filters-rename-dup'
        )
        .map((c) => c.name || c.to)
        .filter(Boolean)

      let content = scriptResult.content
      const renames = collectRenames(allChanges)
      if (Object.keys(renames).length) {
        const tplResult = applySfcTransforms(content, ctx.file.absPath, (tpl) =>
          rewriteFilterCallAliases(tpl, renames)
        )
        allChanges = allChanges.concat(tplResult.changes || [])
        content = tplResult.content
      }

      if (allChanges.length && content !== ctx.file.content) {
        ctx.setContent(content, 'migrate-filters')
        changed = true
        ctx.report({
          level: 'info',
          plugin: 'migrate-filters',
          message: 'filters→methods ×' + allChanges.length,
        })
      }
    } else {
      const result = migrateFiltersOption(ctx.file.content, ctx.file.absPath)
      allChanges = result.changes || []
      migratedNames = allChanges
        .filter(
          (c) =>
            c.kind === 'filters-to-methods' ||
            c.kind === 'filters-rename-methods' ||
            c.kind === 'filters-rename-dup'
        )
        .map((c) => c.name || c.to)
        .filter(Boolean)
      if (allChanges.length && result.code !== ctx.file.content) {
        ctx.setContent(result.code, 'migrate-filters')
        changed = true
        ctx.report({
          level: 'info',
          plugin: 'migrate-filters',
          message: 'filters→methods ×' + allChanges.length,
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

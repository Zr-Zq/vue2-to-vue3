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
 * JS 流：options.filters → methods。
 * 可独立跑；也可消费 HTML 流写入的 handoff。找不到 filters 则 skip（不报错）。
 */
module.exports = createPlugin({
  name: 'migrate-filters',
  description: 'JS 流：options.filters → methods（消费 HTML handoff；找不到则 skip）',
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
          note: 'filters 已并入 methods',
        })
      } else {
        // HTML 交了班，但 script 里已无 filters（或已被人改过）→ skip
        resolveHandoffItem(ctx.project, {
          file: ctx.file.path,
          kind: 'filters-to-methods',
          status: 'skipped',
          note:
            expected.length > 0
              ? 'JS 侧未找到 options.filters（期望: ' + expected.join(', ') + '），忽略'
              : 'JS 侧未找到 options.filters，忽略',
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

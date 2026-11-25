const { createPlugin } = require('../create-plugin')
const { migrateOptionsToComposition } = require('../../transform/options-to-composition')
const { rewriteFilterCallAliases } = require('../../transform/html-filters')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const { decomposeVue } = require('../../sfc-parts')

function renamesFromChanges(changes) {
  const renames = Object.create(null)
  ;(changes || []).forEach((c) => {
    if (c && c.kind === 'filters-rename-dup' && c.from && c.to) renames[c.from] = c.to
  })
  return renames
}

/**
 * Options API → <script setup> (no defineComponent).
 * $parent/$children/$root → AI-TODO only (not rewritten).
 */

/** Turn the opening <script> that owns contentStart into <script setup …>. */
function promoteScriptOpenTag(vueSource, contentStartOffset) {
  if (contentStartOffset == null || contentStartOffset < 0) return vueSource
  const head = String(vueSource).slice(0, contentStartOffset)
  const idx = head.toLowerCase().lastIndexOf('<script')
  if (idx === -1) return vueSource
  const after = head.slice(idx)
  const close = after.indexOf('>')
  if (close === -1) return vueSource
  const tag = after.slice(0, close + 1)
  if (/\bsetup\b/i.test(tag)) return vueSource
  // <script> or <script lang="ts"> → insert setup
  const promoted = tag.replace(/^<script/i, '<script setup')
  return String(vueSource).slice(0, idx) + promoted + String(vueSource).slice(idx + tag.length)
}

module.exports = createPlugin({
  name: 'migrate-options-composition',
  description: 'Options → <script setup> (ref/computed/watch/lifecycle); track this bind/call',
  version: '0.2.0',
  defaults: { enabled: true, stream: 'js' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    if (/\/\*\s*v23:composition\s*\*\//.test(ctx.file.content)) return false

    const isVue = ctx.file.kind === 'vue' || ctx.file.ext === '.vue'
    const isPlainJs =
      ctx.file.ext === '.js' ||
      ctx.file.ext === '.ts' ||
      ctx.file.ext === '.mjs' ||
      ctx.file.ext === '.cjs'

    if (!isVue && !isPlainJs) return false

    const looksOptions =
      /export\s+default\s*\{/.test(ctx.file.content) &&
      /\bdata\s*\(|\bmethods\s*:|\bcomputed\s*:|\bmixins\s*:/.test(ctx.file.content)

    if (isVue) {
      // Already script setup
      if (
        /<script\s[^>]*\bsetup\b/i.test(ctx.file.content) &&
        !/export\s+default\s*\{/.test(ctx.file.content)
      ) {
        return false
      }
      return looksOptions
    }

    // Plain .js/.ts mixins & sidecar Options: detect only (do not rewrite to script-setup —
    // that drops `export default` and breaks mixin imports).
    return looksOptions
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return

    const isVue = ctx.file.ext === '.vue' || ctx.file.kind === 'vue'

    // Plain .js/.ts: preserve export default Options (mixins, shared option objects).
    // Only leave an AI-TODO — macros like defineProps need a real .vue SFC.
    if (!isVue) {
      const code = ctx.file.content
      if (!/AI-TODO:\s*\[options-to-composition\]/.test(code)) {
        ctx.setContent(
          '/* AI-TODO: [options-to-composition] Options API in plain .js/.ts — keep export default; move into .vue <script setup> or convert manually (do not emit script-setup macros here) */\n' +
            code,
          'migrate-options-composition'
        )
        ctx.report({
          level: 'info',
          plugin: 'migrate-options-composition',
          message: 'options plain .js/.ts → AI-TODO only (preserve export default)',
        })
      }
      return
    }

    const run = (js, meta) => {
      if (meta && meta.setup) return { code: js, changes: [] }
      return migrateOptionsToComposition(js, { filename: ctx.file.path })
    }

    const before = decomposeVue(ctx.file.content, ctx.file.absPath)
    const scriptPart = (before.jsParts || []).find((p) => !p.setup)
    const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, run)
    if (result.changes.some((c) => c.kind === 'keep-options')) {
      if (result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-options-composition')
      }
      ctx.report({
        level: 'info',
        plugin: 'migrate-options-composition',
        message: 'kept Options API (imported mixins / extends) → AI-TODO only',
      })
      return
    }
    if (result.changes.length && result.content !== ctx.file.content) {
      let content = result.content
      const renames = renamesFromChanges(result.changes)
      if (Object.keys(renames).length) {
        const tpl = applySfcTransforms(content, ctx.file.absPath, (t) =>
          rewriteFilterCallAliases(t, renames)
        )
        content = tpl.content
      }
      if (scriptPart && scriptPart.range && typeof scriptPart.range.startOffset === 'number') {
        // Offsets shift if we only replaced inner content (same length span start still valid
        // when edit is inside the same script — startOffset of content is unchanged).
        content = promoteScriptOpenTag(content, scriptPart.range.startOffset)
      } else {
        content = content.replace(/<script(\s[^>]*)?>/i, (m) => {
          if (/\bsetup\b/i.test(m)) return m
          return m.replace(/^<script/i, '<script setup')
        })
      }
      ctx.setContent(content, 'migrate-options-composition')
      ctx.report({
        level: 'info',
        plugin: 'migrate-options-composition',
        message: 'options→script-setup changes ×' + result.changes.length,
      })
    }
  },
})

module.exports.promoteScriptOpenTag = promoteScriptOpenTag

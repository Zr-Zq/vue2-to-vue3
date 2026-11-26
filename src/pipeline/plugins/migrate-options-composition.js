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

/** Map template ref="from" → ref="to" when data/method collided with $refs name. */
function tplRefRenamesFromChanges(changes) {
  const renames = Object.create(null)
  ;(changes || []).forEach((c) => {
    if (c && c.kind === 'tpl-ref-rename' && c.from && c.to) renames[c.from] = c.to
  })
  return renames
}

/** All ref="name" in template (script setup needs matching const name = ref()). */
function collectTemplateRefNames(tpl) {
  const names = []
  const seen = Object.create(null)
  const re = /\bref\s*=\s*(["'])([^"'\s]+)\1/g
  const src = String(tpl || '')
  let m
  while ((m = re.exec(src))) {
    const n = m[2]
    if (!n || seen[n]) continue
    seen[n] = true
    names.push(n)
  }
  return names
}

/**
 * ref= on component-like tags (kebab-case or PascalCase) — used to rewrite $children.
 * Native tags (div/input/…) are excluded.
 */
function collectComponentTemplateRefs(tpl) {
  const names = []
  const seen = Object.create(null)
  const re = /<([A-Za-z][\w-]*)\b([^>]*)\/?>/g
  const src = String(tpl || '')
  let m
  while ((m = re.exec(src))) {
    const tag = m[1]
    const attrs = m[2] || ''
    const isComp = tag.indexOf('-') !== -1 || /^[A-Z]/.test(tag)
    if (!isComp) continue
    const rm = /\bref\s*=\s*(["'])([^"'\s]+)\1/.exec(attrs)
    if (!rm) continue
    const n = rm[2]
    if (!n || seen[n]) continue
    seen[n] = true
    names.push(n)
  }
  return names
}

function rewriteTemplateRefAttrs(tpl, renames) {
  let code = String(tpl || '')
  const changes = []
  Object.keys(renames).forEach((from) => {
    const to = renames[from]
    const re = new RegExp('(\\sref\\s*=\\s*)([\"\'])' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\2', 'g')
    const next = code.replace(re, (m, pre, q) => {
      changes.push({ kind: 'tpl-ref-attr', from: from, to: to })
      return pre + q + to + q
    })
    code = next
  })
  return { code: code, changes: changes }
}

/**
 * Options API to <script setup> (no defineComponent).
 * $parent/$children/$root to AI-TODO only (not rewritten).
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
  // <script> or <script lang="ts"> to insert setup
  const promoted = tag.replace(/^<script/i, '<script setup')
  return String(vueSource).slice(0, idx) + promoted + String(vueSource).slice(idx + tag.length)
}

module.exports = createPlugin({
  name: 'migrate-options-composition',
  description: 'Options to <script setup> (ref/computed/watch/lifecycle); track this bind/call',
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
          message: 'options plain .js/.ts to AI-TODO only (preserve export default)',
        })
      }
      return
    }

    const before = decomposeVue(ctx.file.content, ctx.file.absPath)
    const scriptPart = (before.jsParts || []).find((p) => !p.setup)
    const tplCode = before.template && before.template.code != null ? before.template.code : ''
    const templateRefNames = collectTemplateRefNames(tplCode)
    const componentTemplateRefs = collectComponentTemplateRefs(tplCode)
    const run = (js, meta) => {
      if (meta && meta.setup) return { code: js, changes: [] }
      return migrateOptionsToComposition(js, {
        filename: ctx.file.path,
        templateRefNames,
        componentTemplateRefs,
      })
    }
    const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, run)
    if (result.changes.some((c) => c.kind === 'keep-options')) {
      if (result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-options-composition')
      }
      ctx.report({
        level: 'info',
        plugin: 'migrate-options-composition',
        message: 'kept Options API (imported mixins / extends) to AI-TODO only',
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
      const tplRefRenames = tplRefRenamesFromChanges(result.changes)
      if (Object.keys(tplRefRenames).length) {
        const tpl = applySfcTransforms(content, ctx.file.absPath, (t) =>
          rewriteTemplateRefAttrs(t, tplRefRenames)
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
        message: 'optionstoscript-setup changes ×' + result.changes.length,
      })
    }
  },
})

module.exports.promoteScriptOpenTag = promoteScriptOpenTag

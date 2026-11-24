const { createPlugin } = require('../create-plugin')
const {
  stripTemplateFunctionalAttr,
  migrateFunctionalTemplate,
  migrateFunctionalScript,
  residualFunctionalContext,
} = require('../../transform/functional')
const { applySfcTransforms } = require('../../transform/apply-sfc')

function looksFunctional(src) {
  return (
    /<template[^>]*\bfunctional\b/i.test(src) ||
    /\bfunctional\s*:\s*true\b/.test(src) ||
    /v-on\s*=\s*["']listeners["']/.test(src) ||
    /v-bind\s*=\s*["']data\.attrs["']/.test(src)
  )
}

module.exports = createPlugin({
  name: 'migrate-functional',
  description: '<template functional> / functional:true → 普通组件（官方迁移路径）',
  version: '0.1.0',
  defaults: { enabled: true },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return looksFunctional(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    let content = ctx.file.content
    const allChanges = []

    if (ctx.file.ext === '.vue' || ctx.file.kind === 'vue') {
      // 先清掉模板/脚本块外的非法 /* AI-TODO */（会搞坏 SFC 解析）
      content = content.replace(
        /^[ \t]*\/\*\s*迁移脚本注释:[\s\S]*?\*\/[ \t]*\r?\n/gm,
        (m) => {
          if (/\[functional\]/.test(m)) {
            allChanges.push({ kind: 'fn-drop-orphan-comment' })
            return ''
          }
          return m
        }
      )

      const strip = stripTemplateFunctionalAttr(content)
      content = strip.code
      allChanges.push(...strip.changes)

      const wasFunctional =
        strip.changes.length > 0 ||
        /\bfunctional\s*:\s*true\b/.test(content) ||
        /v-on\s*=\s*["']listeners["']/.test(content) ||
        /v-bind\s*=\s*["']data\.attrs["']/.test(content)

      const result = applySfcTransforms(
        content,
        ctx.file.absPath,
        wasFunctional ? (tpl) => migrateFunctionalTemplate(tpl) : null,
        (js, meta) => migrateFunctionalScript(js, ctx.file.absPath + '#' + (meta && meta.id))
      )
      content = result.content
      allChanges.push(...result.changes)

      // SFC 解析失败时的兜底：直接改 <template>…</template> / <script>…</script>
      if (
        wasFunctional &&
        (/v-on\s*=\s*["']listeners["']/.test(content) ||
          /\bfunctional\s*:\s*true\b/.test(content) ||
          /(?:^|[^$])\bprops\./.test(content))
      ) {
        content = content.replace(
          /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/i,
          (full, open, body, close) => {
            const r = migrateFunctionalTemplate(body)
            if (!r.changes.length) return full
            allChanges.push(...r.changes)
            return open + r.code + close
          }
        )
        content = content.replace(
          /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/i,
          (full, open, body, close) => {
            const r = migrateFunctionalScript(body, ctx.file.absPath + '#fallback')
            if (!r.changes.length) return full
            allChanges.push(...r.changes)
            return open + r.code + close
          }
        )
      }
    } else {
      const r = migrateFunctionalScript(content, ctx.file.absPath)
      content = r.code
      allChanges.push(...r.changes)
    }

    if (allChanges.length && content !== ctx.file.content) {
      ctx.setContent(content, 'migrate-functional')
      ctx.report({
        level: 'info',
        plugin: 'migrate-functional',
        message: 'functional → 普通组件 ×' + allChanges.length,
      })
    }

    const residual = residualFunctionalContext(content)
    if (residual.length) {
      ctx.report({
        level: 'warn',
        plugin: 'migrate-functional',
        message: 'functional 残留需回归: ' + residual.join(','),
      })
    }
  },
})

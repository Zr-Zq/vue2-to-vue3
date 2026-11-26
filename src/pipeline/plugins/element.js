const { createPlugin } = require('../create-plugin')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const {
  migrateElementTemplate,
  migrateElementScript,
  migrateElementStyle,
  migrateElementSource,
} = require('../../transform/element-plus')

function detectHits(content) {
  const hits = []
  if (/from\s+['"]element-ui['"]/.test(content)) hits.push('import-element-ui')
  if (/element-ui\//.test(content)) hits.push('element-ui/path')
  if (/Vue\.use\s*\(\s*ElementUI/.test(content)) hits.push('Vue.use(ElementUI)')
  if (/<el-[a-z]/.test(content)) hits.push('el-* templates')
  if (/MessageBox|\$message|\$confirm|\$loading/.test(content)) hits.push('service-api')
  if (/size:\s*['"]medium['"]|size=["']medium["']/.test(content)) hits.push('size:medium')
  if (/size:\s*['"]mini['"]|size=["']mini["']/.test(content)) hits.push('size:mini')
  if (/type=["']text["']/.test(content)) hits.push('type=text')
  if (/el-icon-/.test(content)) hits.push('el-icon-font')
  if (/yyyy-MM|value-format=["']yyyy/.test(content)) hits.push('fecha-format')
  return hits
}

/**
 * Element UI → Element Plus.
 * - mode: 'migrate' (default) applies deterministic rewrites
 * - mode: 'detect' only reports
 * - mode: 'annotate' prepends a marker comment (legacy)
 */
module.exports = createPlugin({
  name: 'element',
  description: 'Element UI → Element Plus (size/type/format/imports; icons/use as AI-TODO)',
  version: '0.2.0',
  defaults: {
    mode: 'migrate',
    enabled: true,
    packageFrom: 'element-ui',
    packageTo: 'element-plus',
  },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    const c = ctx.file.content
    return (
      /element-ui/.test(c) ||
      /Vue\.use\s*\(\s*ElementUI\s*/.test(c) ||
      /<el-[a-z]/.test(c) ||
      /\bElementUI\b/.test(c) ||
      /el-icon-/.test(c) ||
      /size=["']medium["']|size=["']mini["']/.test(c) ||
      /type=["']text["']/.test(c)
    )
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const mode = (api.options && api.options.mode) || 'migrate'
    const hits = detectHits(ctx.file.content)

    if (mode === 'detect') {
      ctx.report({
        level: hits.length ? 'warn' : 'info',
        plugin: 'element',
        message: 'Element detect: ' + (hits.join(', ') || 'usage'),
      })
      return
    }

    if (mode === 'annotate') {
      if (!ctx.file.content.includes('/* v23:plugin=element */')) {
        ctx.setContent('/* v23:plugin=element */\n' + ctx.file.content, 'element')
      }
      ctx.report({
        level: 'info',
        plugin: 'element',
        message: 'Element annotate: ' + (hits.join(', ') || 'usage'),
      })
      return
    }

    // migrate
    const ext = ctx.file.ext
    const abs = ctx.file.absPath
    let result

    if (ext === '.vue' || ctx.file.kind === 'vue') {
      result = applySfcTransforms(
        ctx.file.content,
        abs,
        (tpl) => migrateElementTemplate(tpl),
        (js) => migrateElementScript(js),
        (css) => migrateElementStyle(css)
      )
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'element')
        ctx.report({
          level: 'info',
          plugin: 'element',
          message: 'Element migrate ×' + result.changes.length,
        })
      } else if (hits.length) {
        ctx.report({
          level: 'info',
          plugin: 'element',
          message: 'Element migrate: no textual rewrite (' + hits.join(', ') + ')',
        })
      }
      return
    }

    if (/\.(scss|sass|css|less)$/i.test(ext || '')) {
      result = migrateElementStyle(ctx.file.content)
    } else {
      result = migrateElementSource(ctx.file.content, abs)
    }

    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'element')
      ctx.report({
        level: 'info',
        plugin: 'element',
        message: 'Element migrate ×' + result.changes.length,
      })
    } else if (hits.length) {
      ctx.report({
        level: 'info',
        plugin: 'element',
        message: 'Element migrate: no textual rewrite (' + hits.join(', ') + ')',
      })
    }
  },
})

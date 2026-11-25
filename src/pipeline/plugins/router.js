const { createPlugin } = require('../create-plugin')
const { migrateRouterModule, migrateRouterScriptSetup } = require('../../transform/js-router')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * Vue Router 3 → 4.
 * Owns this.$router / this.$route (options-composition leaves them alone).
 * mode 'migrate' (default): deterministic rewrite (see transform/js-router.js).
 * mode 'detect': report only.
 */
function collectHits(content) {
  const hits = []
  if (/from\s+['"]vue-router['"]/.test(content)) hits.push('import-vue-router')
  if (/new\s+VueRouter\b/.test(content)) hits.push('new VueRouter')
  if (/mode:\s*['"]history['"]/.test(content)) hits.push('mode:history→createWebHistory')
  if (/mode:\s*['"]hash['"]/.test(content)) hits.push('mode:hash→createWebHashHistory')
  if (/Vue\.use\s*\(\s*VueRouter\s*\)/.test(content)) hits.push('Vue.use(VueRouter)')
  if (/\$router\.push|\$route\b/.test(content)) hits.push('instance-api')
  return hits
}

module.exports = createPlugin({
  name: 'router',
  description: 'Vue Router 3 → 4 (createRouter / history / catch-all / useRoute in script setup)',
  version: '0.2.0',
  defaults: { mode: 'migrate' },
  match(ctx) {
    const c = ctx.file.content
    return (
      /from\s+['"]vue-router['"]/.test(c) ||
      /new\s+VueRouter\b|createRouter\s*\(/.test(c) ||
      /mode:\s*['"]history['"]|mode:\s*['"]hash['"]/.test(c) ||
      /\$router\b|\$route\b/.test(c) ||
      /\brouter-view\b|\brouter-link\b/.test(c)
    )
  },
  async transform(ctx, api) {
    const hits = collectHits(ctx.file.content)
    const mode = (api.options && api.options.mode) || 'migrate'

    if (mode === 'migrate') {
      const isVue = ctx.file.ext === '.vue' || ctx.file.kind === 'vue'
      let next = ctx.file.content
      let changes = []
      if (isVue) {
        const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, (js, meta) =>
          meta && meta.setup ? migrateRouterScriptSetup(js, ctx.file.absPath) : { code: js, changes: [] }
        )
        next = result.content
        changes = result.changes
      } else if (/from\s+['"]vue-router['"]/.test(ctx.file.content)) {
        const result = migrateRouterModule(ctx.file.content, ctx.file.absPath)
        next = result.code
        changes = result.changes
      }
      if (next !== ctx.file.content) {
        ctx.setContent(next, 'router')
        ctx.report({
          level: 'info',
          plugin: 'router',
          message: 'Router 3→4 changes ×' + changes.length + ' (' + [...new Set(changes.map((c) => c.kind))].join(', ') + ')',
        })
        return
      }
    }

    ctx.report({
      level: hits.includes('new VueRouter') || hits.some((h) => h.includes('mode:')) ? 'warn' : 'info',
      plugin: 'router',
      message: 'Router: ' + (hits.join(', ') || 'usage'),
    })

    if (mode === 'annotate' && !ctx.file.content.includes('/* v23:plugin=router */')) {
      ctx.setContent('/* v23:plugin=router */\n' + ctx.file.content, 'router')
    }
  },
})

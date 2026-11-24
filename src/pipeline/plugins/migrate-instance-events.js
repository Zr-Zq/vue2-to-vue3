const fs = require('fs')
const path = require('path')
const { createPlugin } = require('../create-plugin')
const { applySfcTransforms } = require('../../transform/apply-sfc')
const {
  migrateInstanceEvents,
  needsInstanceEventBus,
} = require('../../transform/js-instance-events')
const { ensureProjectWorkDir } = require('../../paths')

const BUS_REL = 'src/compat/v23-bus.js'
const TEMPLATE_BUS = path.join(__dirname, '../../../templates/v23-bus.js')

function ensureLedger(project) {
  if (!project.shared.migrationLedger) project.shared.migrationLedger = []
  return project.shared.migrationLedger
}

function ensureBusFile(projectRoot, ledger) {
  const dest = path.join(projectRoot, BUS_REL)
  if (fs.existsSync(dest)) return { created: false, path: BUS_REL }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(TEMPLATE_BUS, dest)
  ledger.push({
    who: 'script',
    kind: 'compat-add',
    file: BUS_REL,
    detail: 'Added Vue3 event-bus shim (v23-bus) for $on/$off/$once',
  })
  return { created: true, path: BUS_REL }
}

/**
 * Patch main entry to:
 *   import { bus as __v23Bus } from '@/compat/v23-bus'
 *   const __v23App = createApp(...)
 *   __v23App.config.globalProperties.$bus = __v23Bus
 *   __v23App.use(...).mount(...)
 */
function ensureMainRegistersBus(projectRoot, ledger) {
  const candidates = ['src/main.js', 'src/main.ts', 'src/main.mjs']
  let mainAbs = null
  let rel = null
  for (let i = 0; i < candidates.length; i += 1) {
    const p = path.join(projectRoot, candidates[i])
    if (fs.existsSync(p)) {
      mainAbs = p
      rel = candidates[i]
      break
    }
  }
  if (!mainAbs) return { patched: false }

  let text = fs.readFileSync(mainAbs, 'utf8')
  if (/globalProperties\s*\.\s*\$bus/.test(text) && /compat\/v23-bus/.test(text)) {
    return { patched: false, already: true }
  }

  if (!/from\s+['"]@\/compat\/v23-bus['"]/.test(text)) {
    const importLine = "import { bus as __v23Bus } from '@/compat/v23-bus'\n"
    const importBlock = text.match(/^(?:import[\s\S]*?;\r?\n)+/)
    if (importBlock) {
      text = text.slice(0, importBlock[0].length) + importLine + text.slice(importBlock[0].length)
    } else {
      text = importLine + text
    }
  }

  // createApp(App).use(router).mount('#app')
  // → const __v23App = createApp(App); __v23App.config.globalProperties.$bus = __v23Bus; __v23App.use(router).mount('#app')
  if (!/globalProperties\s*\.\s*\$bus/.test(text)) {
    const chained = text.match(
      /(?:const\s+\w+\s*=\s*)?(createApp\s*\([^;]*?\))((?:\s*\.\s*\w+\s*\([^;]*?\))*)\s*;?/
    )
    if (chained && !/const\s+__v23App\s*=/.test(text)) {
      const full = chained[0]
      const createCall = chained[1]
      const chain = chained[2] || ''
      const replacement =
        'const __v23App = ' +
        createCall +
        '\n__v23App.config.globalProperties.$bus = __v23Bus\n__v23App' +
        chain +
        (full.trim().endsWith(';') || chain ? '' : '') +
        (/\s*;\s*$/.test(full) ? ';' : '')
      text = text.replace(full, replacement)
    }
  }

  if (!/globalProperties\s*\.\s*\$bus/.test(text)) {
    text +=
      '\n/* migrate-script note: AI-TODO [compat-bus] Wire __v23Bus onto createApp().config.globalProperties.$bus */\n'
  }

  fs.writeFileSync(mainAbs, text, 'utf8')
  ledger.push({
    who: 'script',
    kind: 'compat-register',
    file: rel,
    detail: 'Registered globalProperties.$bus from @/compat/v23-bus',
  })
  return { patched: true, file: rel }
}

module.exports = createPlugin({
  name: 'migrate-instance-events',
  description: 'this.$on/$off/$once → this.$bus.*; ensure compat/v23-bus.js + main register',
  version: '0.1.0',
  defaults: { enabled: true, stream: 'js' },
  match(ctx, api) {
    if (api.options && api.options.enabled === false) return false
    return needsInstanceEventBus(ctx.file.content)
  },
  async transform(ctx, api) {
    if (api.options && api.options.enabled === false) return
    const ledger = ensureLedger(api.project)
    ensureBusFile(api.project.root, ledger)

    const apply = (js) => migrateInstanceEvents(js)

    if (ctx.file.ext === '.vue') {
      const result = applySfcTransforms(ctx.file.content, ctx.file.absPath, null, apply)
      if (result.changes.length && result.content !== ctx.file.content) {
        ctx.setContent(result.content, 'migrate-instance-events')
        api.project.shared.needsV23BusRegister = true
        result.changes.forEach((c) => {
          ledger.push({
            who: 'script',
            kind: 'rewrite',
            file: ctx.file.path,
            detail: 'Rewrote this.' + c.api + ' → this.$bus.' + c.api,
          })
        })
        ctx.report({
          level: 'info',
          plugin: 'migrate-instance-events',
          message: 'instance-events rewrites ×' + result.changes.length,
        })
      }
      return
    }

    const result = apply(ctx.file.content)
    if (result.changes.length && result.code !== ctx.file.content) {
      ctx.setContent(result.code, 'migrate-instance-events')
      api.project.shared.needsV23BusRegister = true
      result.changes.forEach((c) => {
        ledger.push({
          who: 'script',
          kind: 'rewrite',
          file: ctx.file.path,
          detail: 'Rewrote this.' + c.api + ' → this.$bus.' + c.api,
        })
      })
      ctx.report({
        level: 'info',
        plugin: 'migrate-instance-events',
        message: 'instance-events rewrites ×' + result.changes.length,
      })
    }
  },
  async teardown(project) {
    const ledger = ensureLedger(project)
    if (project.shared.needsV23BusRegister) {
      ensureMainRegistersBus(project.root, ledger)
    }
    const work = ensureProjectWorkDir(project.root)
    fs.writeFileSync(
      path.join(work, 'migration-ledger.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), items: ledger }, null, 2),
      'utf8'
    )
  },
})

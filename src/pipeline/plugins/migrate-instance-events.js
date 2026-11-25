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
 * Find index of ')' matching the '(' at openIdx, skipping strings/comments.
 * @returns {number} index of matching ')' or -1
 */
function findMatchingParen(text, openIdx) {
  let depth = 0
  let inStr = null
  let escaped = false
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i]
    if (inStr) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\' && inStr !== '`') {
        escaped = true
        continue
      }
      if (inStr === '`' && ch === '$' && text[i + 1] === '{') {
        // Template expression: recurse-ish by tracking brace depth inside ${}
        i += 2
        let brace = 1
        while (i < text.length && brace > 0) {
          const c = text[i]
          if (c === '{') brace += 1
          else if (c === '}') brace -= 1
          i += 1
        }
        i -= 1
        continue
      }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      i += 2
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Locate createApp(...) plus optional .use()/.mount() chain using balanced parens.
 * Avoids the old /createApp\s*\([^;]*?\)/ bug that truncates on the first ')'
 * inside arrow factories like createApp(() => ...).
 *
 * @returns {{ start: number, createEnd: number, end: number, assignVar: string|null }|null}
 */
function locateCreateAppChain(text) {
  const re = /createApp\s*\(/g
  const m = re.exec(text)
  if (!m) return null
  const createStart = m.index
  const openParen = createStart + m[0].length - 1
  const createClose = findMatchingParen(text, openParen)
  if (createClose < 0) return null

  let end = createClose + 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rest = text.slice(end)
    const chain = rest.match(/^\s*\.\s*[A-Za-z_$][\w$]*\s*\(/)
    if (!chain) break
    const open = end + chain[0].length - 1
    const close = findMatchingParen(text, open)
    if (close < 0) break
    end = close + 1
  }

  const before = text.slice(0, createStart)
  const assign = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/)
  return {
    start: assign ? before.length - assign[0].length : createStart,
    createStart,
    createEnd: createClose + 1,
    end,
    assignVar: assign ? assign[1] : null,
  }
}

/**
 * Pure text transform: inject $bus onto createApp result.
 * Exported for unit tests.
 */
function patchMainBusRegister(text) {
  let out = String(text || '')
  if (/globalProperties\s*\.\s*\$bus/.test(out)) return out

  if (!/from\s+['"]@\/compat\/v23-bus['"]/.test(out)) {
    const importLine = "import { bus as __v23Bus } from '@/compat/v23-bus'\n"
    const importBlock = out.match(/^(?:import[\s\S]*?;\r?\n)+/)
    if (importBlock) {
      out = out.slice(0, importBlock[0].length) + importLine + out.slice(importBlock[0].length)
    } else {
      out = importLine + out
    }
  }

  if (!/globalProperties\s*\.\s*\$bus/.test(out)) {
    const loc = locateCreateAppChain(out)
    if (loc && !/const\s+__v23App\s*=/.test(out)) {
      const createCall = out.slice(loc.createStart, loc.createEnd)
      const chain = out.slice(loc.createEnd, loc.end)
      const trailingSemi = /^\s*;/.test(out.slice(loc.end))
      let replacement
      if (loc.assignVar) {
        const varName = loc.assignVar
        replacement =
          'const ' +
          varName +
          ' = ' +
          createCall +
          '\n' +
          varName +
          '.config.globalProperties.$bus = __v23Bus\n' +
          varName +
          chain +
          (trailingSemi ? '' : '')
        out = out.slice(0, loc.start) + replacement + out.slice(loc.end)
      } else {
        replacement =
          'const __v23App = ' +
          createCall +
          '\n__v23App.config.globalProperties.$bus = __v23Bus\n__v23App' +
          chain
        out = out.slice(0, loc.createStart) + replacement + out.slice(loc.end)
      }
    }
  }

  if (!/globalProperties\s*\.\s*\$bus/.test(out)) {
    out +=
      '\n/* migrate-script note: AI-TODO [compat-bus] Wire __v23Bus onto createApp().config.globalProperties.$bus */\n'
  }
  return out
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

  const before = fs.readFileSync(mainAbs, 'utf8')
  if (/globalProperties\s*\.\s*\$bus/.test(before) && /compat\/v23-bus/.test(before)) {
    return { patched: false, already: true }
  }

  const text = patchMainBusRegister(before)
  fs.writeFileSync(mainAbs, text, 'utf8')
  ledger.push({
    who: 'script',
    kind: 'compat-register',
    file: rel,
    detail: 'Registered globalProperties.$bus from @/compat/v23-bus',
  })
  return { patched: true, file: rel }
}

const plugin = createPlugin({
  name: 'migrate-instance-events',
  description: 'this.$on/$off/$once to this.$bus.*; ensure compat/v23-bus.js + main register',
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
            detail: 'Rewrote this.' + c.api + ' to this.$bus.' + c.api,
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
          detail: 'Rewrote this.' + c.api + ' to this.$bus.' + c.api,
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

module.exports = plugin
module.exports.patchMainBusRegister = patchMainBusRegister
module.exports.findMatchingParen = findMatchingParen
module.exports.locateCreateAppChain = locateCreateAppChain

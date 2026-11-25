const { createPlugin } = require('../create-plugin')
const { pushRisk } = require('../risk/helpers')
const { applySfcTransforms } = require('../../transform/apply-sfc')

/**
 * TypeScript / lang="ts": detect + carry policy lives in options-to-composition.
 * Class components / vue-property-decorator: detect + AI-TODO only (no Options rewrite).
 */

const DECORATOR_NAMES = [
  'Component',
  'Prop',
  'Watch',
  'Emit',
  'Ref',
  'Inject',
  'Provide',
  'Model',
  'PropSync',
  'VModel',
  'Options',
  'Setup',
]

const CLASS_PKG_RE = /vue-property-decorator|vue-class-component|vue-facing-decorator/

function listDecorators(code) {
  const s = String(code || '')
  const found = []
  DECORATOR_NAMES.forEach((n) => {
    const re = new RegExp('@' + n + '\\b')
    if (re.test(s)) found.push('@' + n)
  })
  if (CLASS_PKG_RE.test(s)) {
    const pkgs = []
    if (/vue-property-decorator/.test(s)) pkgs.push('vue-property-decorator')
    if (/vue-class-component/.test(s)) pkgs.push('vue-class-component')
    if (/vue-facing-decorator/.test(s)) pkgs.push('vue-facing-decorator')
    pkgs.forEach((p) => {
      if (!found.includes(p)) found.push(p)
    })
  }
  return found
}

function isClassComponentSource(code) {
  return listDecorators(code).length > 0
}

const AI_TODO_CLASS =
  '/* AI-TODO: [typescript-class] vue-class-component / decorators detected (%LIST%). ' +
  'Convert to Options API first or migrate Composition by hand — scripts do not auto-rewrite class components. */\n'

function insertClassAiTodo(code, decorators) {
  const s = String(code || '')
  if (/AI-TODO:\s*\[typescript-class\]/.test(s)) return { code: s, inserted: false }
  const list = decorators.length ? decorators.join(', ') : 'class-component'
  const marker = AI_TODO_CLASS.replace('%LIST%', list)
  return { code: marker + s, inserted: true }
}

module.exports = createPlugin({
  name: 'typescript',
  description: 'TypeScript detect; class/decorators → AI-TODO (no auto Options/setup rewrite)',
  version: '0.2.0',
  defaults: { mode: 'detect' },
  match(ctx) {
    const f = ctx.file
    if (f.ext === '.ts' || f.ext === '.tsx') return true
    if (f.kind === 'vue' && /lang\s*=\s*["']tsx?["']/i.test(f.content)) return true
    if (isClassComponentSource(f.content)) return true
    return false
  },
  async transform(ctx, api) {
    const hits = []
    if (/lang\s*=\s*["']tsx?["']/i.test(ctx.file.content)) hits.push('lang=ts')
    if (ctx.file.ext === '.ts' || ctx.file.ext === '.tsx') hits.push('ts-file')

    const decorators = listDecorators(ctx.file.content)
    if (decorators.length) hits.push('class-component')

    ctx.report({
      level: decorators.length ? 'warn' : 'info',
      plugin: 'typescript',
      message: hits.length ? 'TS: ' + hits.join(', ') + (decorators.length ? ' [' + decorators.join(', ') + ']' : '') : 'TS related files',
    })

    if (decorators.length && api && api.project) {
      pushRisk(api.project, {
        file: ctx.file.path,
        id: 'typescript.class-component',
        category: 'typescript-class',
        level: 'warn',
        auto: 'no',
        evidence: decorators.join(', '),
        hint:
          'Convert class/@Component/@Prop/@Watch (vue-property-decorator) to Options first, or hand-migrate Composition. Scripts do not rewrite class components.',
        message: 'Class component / decorators — AI-TODO only',
      })
    }

    let content = ctx.file.content
    let changed = false

    if (decorators.length) {
      if (ctx.file.ext === '.vue' || ctx.file.kind === 'vue') {
        const result = applySfcTransforms(content, ctx.file.absPath, null, (js) => {
          if (!isClassComponentSource(js)) return { code: js, changes: [] }
          const r = insertClassAiTodo(js, listDecorators(js))
          return {
            code: r.code,
            changes: r.inserted ? [{ kind: 'ai-typescript-class' }] : [],
          }
        })
        if (result.changes.length && result.content !== content) {
          content = result.content
          changed = true
        }
      } else {
        const r = insertClassAiTodo(content, decorators)
        if (r.inserted) {
          content = r.code
          changed = true
        }
      }
    }

    if (api.options.mode === 'annotate' && !content.includes('/* v23:plugin=typescript */')) {
      content = '/* v23:plugin=typescript */\n' + content
      changed = true
    }

    if (changed) {
      ctx.setContent(content, 'typescript')
    }
  },
})

module.exports.listDecorators = listDecorators
module.exports.insertClassAiTodo = insertClassAiTodo

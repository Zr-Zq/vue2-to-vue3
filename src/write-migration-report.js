/**
 * Build a human/AI-readable table of who did what after migration.
 * Sources: pipeline-report.json, ai-todos.json, migration-ledger.json, scaffold-notes.md
 */
const fs = require('fs')
const path = require('path')
const { projectWorkDir, ensureProjectWorkDir } = require('./paths')

function readJson(p) {
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    return null
  }
}

function writeMigrationReport(projectRoot) {
  const root = path.resolve(projectRoot)
  const work = ensureProjectWorkDir(root)
  const rows = []

  // AI scaffold notes
  const scaffoldNotes = path.join(work, 'scaffold-notes.md')
  if (fs.existsSync(scaffoldNotes)) {
    rows.push({
      who: 'AI',
      kind: 'scaffold',
      file: '.v23/scaffold-notes.md',
      detail: 'Vue3 base / project config (see scaffold-notes)',
    })
  }

  // Script ledger (compat adds, rewrites recorded by plugins)
  const ledger = readJson(path.join(work, 'migration-ledger.json'))
  ;(ledger && ledger.items ? ledger.items : []).forEach((it) => {
    rows.push({
      who: it.who || 'script',
      kind: it.kind || 'rewrite',
      file: it.file || '',
      detail: it.detail || '',
    })
  })

  // Pipeline changed files
  const pipe = readJson(path.join(work, 'pipeline-report.json'))
  if (pipe && Array.isArray(pipe.results)) {
    pipe.results
      .filter((r) => r.changed)
      .forEach((r) => {
        const by = (r.changedBy || []).join(', ')
        // Skip if already covered by ledger rewrite for same file+plugin
        const already = rows.some(
          (x) => x.file === r.path && x.kind === 'rewrite' && by.includes('migrate-instance-events')
        )
        if (already && by === 'migrate-instance-events') return
        rows.push({
          who: 'script',
          kind: 'pipeline',
          file: r.path,
          detail: 'Pipeline changed by: ' + (by || '(unknown)'),
        })
      })
  }

  // AI-TODO items
  const todos = readJson(path.join(work, 'ai-todos.json'))
  const todoList = Array.isArray(todos)
    ? todos
    : todos && Array.isArray(todos.todos)
      ? todos.todos
      : todos && Array.isArray(todos.items)
        ? todos.items
        : []
  todoList.forEach((t) => {
    rows.push({
      who: 'AI',
      kind: 'todo',
      file: t.file + (t.line ? ':' + t.line : ''),
      detail: (t.category ? '[' + t.category + '] ' : '') + (t.message || t.text || ''),
    })
  })

  const md = []
  md.push('# Migration ownership report')
  md.push('')
  md.push('Generated: ' + new Date().toISOString())
  md.push('')
  md.push('| Who | Kind | File | Detail |')
  md.push('|-----|------|------|--------|')
  rows.forEach((r) => {
    md.push(
      '| ' +
        (r.who || '') +
        ' | ' +
        (r.kind || '') +
        ' | `' +
        String(r.file || '').replace(/\|/g, '\\|') +
        '` | ' +
        String(r.detail || '')
          .replace(/\|/g, '\\|')
          .replace(/\n/g, ' ') +
        ' |'
    )
  })
  md.push('')
  md.push('## Legend')
  md.push('')
  md.push('| Who | Meaning |')
  md.push('|-----|---------|')
  md.push('| **AI** | Base scaffold, AI-TODO items, semantic decisions |')
  md.push('| **script** | Deterministic pipeline rewrites |')
  md.push('| Kind `compat-add` / `compat-register` | New shim files (e.g. `$bus` / `v23-bus`) and wiring |')
  md.push('| Kind `todo` | Left for AI after script handoff |')
  md.push('')

  const outMd = path.join(work, 'migration-report.md')
  const outJson = path.join(work, 'migration-report.json')
  fs.writeFileSync(outMd, md.join('\n'), 'utf8')
  fs.writeFileSync(
    outJson,
    JSON.stringify({ generatedAt: new Date().toISOString(), projectRoot: root, rows }, null, 2),
    'utf8'
  )
  return { outMd, outJson, rows }
}

module.exports = {
  writeMigrationReport,
}

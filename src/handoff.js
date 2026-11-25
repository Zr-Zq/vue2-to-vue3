/**
 * HTML stream ↔ JS stream handoff file: .v23/handoff.json
 *
 * After HTML rewrites the template, if JS must finish the job (e.g. |filter → f() needs filters→methods), write a pending item.
 * JS side consumes it; if matching options are missing, skip without error.
 */
const fs = require('fs')
const path = require('path')
const { ensureProjectWorkDir, projectWorkDir } = require('./paths')

const HANDOFF_VERSION = 1
const HANDOFF_FILENAME = 'handoff.json'

/** Stream split (shared by docs + config) */
const STREAMS = {
  html: {
    description: 'Rewrite template / style only (do not touch business JS semantics)',
    plugins: ['migrate-html', 'migrate-deep', 'migrate-functional'],
  },
  js: {
    description: 'Rewrite script / options objects; may consume HTML handoff items',
    plugins: [
      'migrate-render-h',
      'migrate-api-compat',
      'migrate-directive-hooks',
      'migrate-filters',
      'migrate-extend',
      'migrate-mount',
      // migrate-children disabled: $children → AI (same as $parent/$root)
      'migrate-instance-events',
      'migrate-dynamic-import',
      // Before options→script-setup so components:{ Foo: () => import() } become defineAsyncComponent then hoist
      'migrate-async-component',
      'migrate-options-composition',
    ],
  },
}

function handoffPath(projectRoot) {
  return path.join(projectWorkDir(projectRoot), HANDOFF_FILENAME)
}

function emptyHandoff() {
  return {
    version: HANDOFF_VERSION,
    updatedAt: null,
    description:
      'HTML→JS handoff. HTML stream writes pending; JS stream consumes. status=skipped means JS found no editable target (safe to ignore).',
    streams: STREAMS,
    items: [],
  }
}

function loadHandoff(projectRoot) {
  const p = handoffPath(projectRoot)
  if (!fs.existsSync(p)) return emptyHandoff()
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (!raw || typeof raw !== 'object') return emptyHandoff()
    if (!Array.isArray(raw.items)) raw.items = []
    raw.streams = STREAMS
    raw.version = HANDOFF_VERSION
    return raw
  } catch (e) {
    return emptyHandoff()
  }
}

function saveHandoff(projectRoot, data) {
  ensureProjectWorkDir(projectRoot)
  const out = Object.assign({}, data || emptyHandoff(), {
    version: HANDOFF_VERSION,
    updatedAt: new Date().toISOString(),
    streams: STREAMS,
  })
  fs.writeFileSync(handoffPath(projectRoot), JSON.stringify(out, null, 2), 'utf8')
  return out
}

function itemKey(item) {
  const filters = (item.filters || []).slice().sort().join(',')
  return [item.kind || '', item.file || '', filters].join('::')
}

function ensureSharedHandoff(project) {
  if (!project.shared.handoff) {
    project.shared.handoff = loadHandoff(project.root)
  }
  return project.shared.handoff
}

/**
 * HTML stream registration: template already rewrote |name to name(); JS stream should merge filters into methods
 */
function addFiltersHandoff(project, fileRel, filterNames) {
  const names = uniqueNames(filterNames)
  if (!names.length) return null
  const data = ensureSharedHandoff(project)
  const item = {
    kind: 'filters-to-methods',
    fromStream: 'html',
    toStream: 'js',
    toPlugin: 'migrate-filters',
    file: fileRel,
    filters: names,
    status: 'pending',
    note: 'Template |filter rewritten to function call; need options.filters → methods',
    updatedAt: new Date().toISOString(),
  }
  const key = itemKey(item)
  const idx = data.items.findIndex((x) => itemKey(x) === key)
  if (idx >= 0) {
    // On re-register from HTML: keep done; reset skipped/pending to pending (allow re-run)
    if (data.items[idx].status === 'done') return data.items[idx]
    data.items[idx] = Object.assign({}, data.items[idx], item, { status: 'pending' })
  } else {
    data.items.push(item)
  }
  return item
}

/**
 * JS stream writes back status
 * @param {'done'|'skipped'|'pending'} status
 */
function resolveHandoffItem(project, { file, kind, status, note, filters }) {
  const data = ensureSharedHandoff(project)
  const kindName = kind || 'filters-to-methods'
  let hit = 0
  data.items.forEach((it) => {
    if (it.file !== file || it.kind !== kindName) return
    if (filters && filters.length) {
      const a = (it.filters || []).slice().sort().join(',')
      const b = filters.slice().sort().join(',')
      if (a !== b) return
    }
    it.status = status
    if (note) it.note = note
    it.updatedAt = new Date().toISOString()
    hit += 1
  })
  return hit
}

function pendingForFile(project, fileRel, kind) {
  const data = ensureSharedHandoff(project)
  return data.items.filter(
    (it) => it.file === fileRel && it.status === 'pending' && (!kind || it.kind === kind)
  )
}

function flushHandoff(project) {
  if (!project || !project.shared || !project.shared.handoff) return null
  if (project.dryRun) return project.shared.handoff
  return saveHandoff(project.root, project.shared.handoff)
}

function uniqueNames(list) {
  const out = []
  const seen = Object.create(null)
  ;(list || []).forEach((n) => {
    if (!n || seen[n]) return
    seen[n] = true
    out.push(n)
  })
  return out
}

module.exports = {
  STREAMS,
  HANDOFF_FILENAME,
  handoffPath,
  emptyHandoff,
  loadHandoff,
  saveHandoff,
  ensureSharedHandoff,
  addFiltersHandoff,
  resolveHandoffItem,
  pendingForFile,
  flushHandoff,
  itemKey,
}

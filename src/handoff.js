/**
 * HTML 流 ↔ JS 流交接文件：.v23/handoff.json
 *
 * HTML 侧改模板后若依赖 JS 补齐（如 |filter → f() 需 filters→methods），写入 pending item。
 * JS 侧消费；找不到对应 options 就 skip，不报错。
 */
const fs = require('fs')
const path = require('path')
const { ensureProjectWorkDir, projectWorkDir } = require('./paths')

const HANDOFF_VERSION = 1
const HANDOFF_FILENAME = 'handoff.json'

/** 流划分（文档 + 配置共用） */
const STREAMS = {
  html: {
    description: '只改 template / style（不碰业务 JS 语义）',
    plugins: ['migrate-html', 'migrate-deep', 'migrate-functional'],
  },
  js: {
    description: '只改 script / 选项对象；可消费 HTML 交接项',
    plugins: [
      'migrate-render-h',
      'migrate-api-compat',
      'migrate-directive-hooks',
      'migrate-filters',
      'migrate-extend',
      'migrate-mount',
      'migrate-children',
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
      'HTML→JS 交接。HTML 流写 pending；JS 流消费。status=skipped 表示 JS 侧找不到可改对象（忽略即可）。',
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
 * HTML 流登记：模板已把 |name 改成 name()，请 JS 流把 filters 并入 methods
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
    note: '模板 |filter 已改为函数调用，需 options.filters → methods',
    updatedAt: new Date().toISOString(),
  }
  const key = itemKey(item)
  const idx = data.items.findIndex((x) => itemKey(x) === key)
  if (idx >= 0) {
    // HTML 再次登记时：done 保持；skipped/pending 重置为 pending（允许重跑）
    if (data.items[idx].status === 'done') return data.items[idx]
    data.items[idx] = Object.assign({}, data.items[idx], item, { status: 'pending' })
  } else {
    data.items.push(item)
  }
  return item
}

/**
 * JS 流回写状态
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

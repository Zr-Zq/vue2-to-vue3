/**
 * Back up existing files before overwrite
 * Backup root: <base>/.v23/backup/<timestamp>/
 */
const fs = require('fs')
const path = require('path')
const { projectWorkDir, ensureProjectWorkDir } = require('./paths')
const { toPosixRel } = require('./resolve')

function backupStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  )
}

/**
 * @param {string} baseRoot Migration target root
 * @param {string} [stamp] Shared timestamp for one batch
 * @returns {{ stamp: string, dir: string }}
 */
function ensureBackupBatch(baseRoot, stamp) {
  ensureProjectWorkDir(baseRoot)
  const s = stamp || backupStamp()
  const dir = path.join(projectWorkDir(baseRoot), 'backup', s)
  fs.mkdirSync(dir, { recursive: true })
  return { stamp: s, dir }
}

/**
 * If destAbs already exists: copy to mirrored path under backupDir relative to baseRoot
 * @returns {{ backedUp: boolean, backupPath: string|null }}
 */
function backupIfExists(baseRoot, destAbs, backupDir) {
  if (!fs.existsSync(destAbs) || !fs.statSync(destAbs).isFile()) {
    return { backedUp: false, backupPath: null }
  }
  const rel = toPosixRel(destAbs, baseRoot) || path.basename(destAbs)
  const dest = path.join(backupDir, rel.split('/').join(path.sep))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(destAbs, dest)
  return { backedUp: true, backupPath: dest }
}

module.exports = {
  backupStamp,
  ensureBackupBatch,
  backupIfExists,
}

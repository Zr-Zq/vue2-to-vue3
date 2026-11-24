const fs = require('fs')
const path = require('path')

/** Repo root (vue2-to-vue3/) */
const REPO_ROOT = path.resolve(__dirname, '../..')

/** Optional human-readable reports: vue2-to-vue3/output */
const OUTPUT_ROOT = path.join(REPO_ROOT, 'output')

/** Work dir name inside target project: analysis artifacts for the pipeline; cleaned after full run */
const PROJECT_WORK_DIRNAME = '.v23'

/**
 * @param {...string} parts
 */
function outputPath(...parts) {
  return path.join(OUTPUT_ROOT, ...parts)
}

/** In-project work directory: <project>/.v23 */
function projectWorkDir(projectRoot) {
  return path.join(path.resolve(projectRoot), PROJECT_WORK_DIRNAME)
}

function projectGraphPath(projectRoot) {
  return path.join(projectWorkDir(projectRoot), 'graph.json')
}

function projectPipelineReportPath(projectRoot) {
  return path.join(projectWorkDir(projectRoot), 'pipeline-report.json')
}

function ensureProjectWorkDir(projectRoot) {
  const dir = projectWorkDir(projectRoot)
  fs.mkdirSync(dir, { recursive: true })
  // Avoid accidental use by app builds / commits
  const gitignore = path.join(dir, '.gitignore')
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, '*\n', 'utf8')
  }
  return dir
}

/** Remove in-project .v23 work directory */
function cleanProjectWorkDir(projectRoot) {
  const dir = projectWorkDir(projectRoot)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }
  return false
}

/** Clean repo output/ */
function cleanOutputRoot() {
  if (fs.existsSync(OUTPUT_ROOT)) {
    fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true })
  }
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  return OUTPUT_ROOT
}

module.exports = {
  REPO_ROOT,
  OUTPUT_ROOT,
  PROJECT_WORK_DIRNAME,
  outputPath,
  projectWorkDir,
  projectGraphPath,
  projectPipelineReportPath,
  ensureProjectWorkDir,
  cleanProjectWorkDir,
  cleanOutputRoot,
}

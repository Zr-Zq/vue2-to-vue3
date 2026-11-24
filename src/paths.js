const fs = require('fs')
const path = require('path')

/** 仓库根目录（vue2-to-vue3/） */
const REPO_ROOT = path.resolve(__dirname, '../..')

/** 人工查阅用报告（可选）：vue2-to-vue3/output */
const OUTPUT_ROOT = path.join(REPO_ROOT, 'output')

/** 目标项目内工作目录名：后续流水线要读的分析产物放这里，全流程结束清理 */
const PROJECT_WORK_DIRNAME = '.v23'

/**
 * @param {...string} parts
 */
function outputPath(...parts) {
  return path.join(OUTPUT_ROOT, ...parts)
}

/** 项目内工作目录：<project>/.v23 */
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
  // 避免被业务构建/提交误用
  const gitignore = path.join(dir, '.gitignore')
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, '*\n', 'utf8')
  }
  return dir
}

/** 清理项目内 .v23 工作目录 */
function cleanProjectWorkDir(projectRoot) {
  const dir = projectWorkDir(projectRoot)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }
  return false
}

/** 清理仓库 output/ */
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

const { buildGraph } = require('./build-graph')
const { renderHtmlReport } = require('./report-html')
const { loadProjectConfig } = require('./config')
const { lookupSymbol } = require('./analyze-mixins')
const pipeline = require('./pipeline')
const paths = require('./paths')
const { writeAnalyze, loadProjectGraph } = require('./write-analyze')
const { ingestFiles } = require('./ingest')
const { detectProjectRoot } = require('./detect-root')
const sfcParts = require('./sfc-parts')
const { parseProjectFile, parseProjectSource, parseJs } = require('./parse-file')
const analyzeHtml = require('./analyze-html')

module.exports = {
  buildGraph,
  renderHtmlReport,
  loadProjectConfig,
  lookupSymbol,
  pipeline,
  runPipeline: pipeline.run,
  writeAnalyze,
  loadProjectGraph,
  ingestFiles,
  detectProjectRoot,
  decomposeVue: sfcParts.decomposeVue,
  isRealJsScript: sfcParts.isRealJsScript,
  parseProjectFile,
  parseProjectSource,
  parseJs,
  analyzeHtmlTemplate: analyzeHtml.analyzeHtmlTemplate,
  analyzeVueHtml: analyzeHtml.analyzeVueHtml,
  scanHtml: analyzeHtml.scanHtml,
  OUTPUT_ROOT: paths.OUTPUT_ROOT,
  outputPath: paths.outputPath,
  projectWorkDir: paths.projectWorkDir,
  cleanProjectWorkDir: paths.cleanProjectWorkDir,
  cleanOutputRoot: paths.cleanOutputRoot,
}

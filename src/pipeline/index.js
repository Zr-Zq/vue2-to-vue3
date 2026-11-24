const { createRegistry } = require('./registry')
const { registerBuiltins } = require('./plugins')
const {
  loadPipelineConfig,
  DEFAULT_PIPELINE,
  DEFAULT_PREFLIGHT_PIPELINE,
  DEFAULT_CONFIG,
} = require('./load-config')
const { runPipeline } = require('./runner')
const { createFileContext, createProjectContext } = require('./context')
const { createPlugin } = require('./create-plugin')
const { writeAnalyze, loadProjectGraph } = require('../write-analyze')

/**
 * 创建带内置插件的注册表
 */
function createDefaultRegistry() {
  return registerBuiltins(createRegistry())
}

/**
 * 主入口：加载配置 → 读/写项目内 .v23 分析 → 按顺序跑流水线
 */
async function run(projectRoot, options) {
  const opts = options || {}
  const config = opts.config || loadPipelineConfig(projectRoot, opts.configPath)
  if (opts.pipeline) config.pipeline = opts.pipeline
  if (opts.dryRun != null) config.dryRun = opts.dryRun
  if (opts.outDir != null) config.outDir = opts.outDir
  if (opts.verbose) config.verbose = true

  const registry = opts.registry || createDefaultRegistry()

  let graph = opts.graph || null
  if (!graph) {
    graph = loadProjectGraph(projectRoot)
  }
  if (config.preflight && !graph) {
    // 没有现成分析时写入项目 .v23，供后续插件 lookup
    const written = writeAnalyze(projectRoot, { html: false })
    graph = written.graph
  }

  return runPipeline({
    root: projectRoot,
    config,
    registry,
    graph,
    dryRun: config.dryRun,
    outDir: config.outDir,
    keepContent: opts.keepContent,
  })
}

module.exports = {
  createRegistry,
  createDefaultRegistry,
  createPlugin,
  createFileContext,
  createProjectContext,
  loadPipelineConfig,
  DEFAULT_PIPELINE,
  DEFAULT_PREFLIGHT_PIPELINE,
  DEFAULT_CONFIG,
  runPipeline,
  run,
  registerBuiltins,
}

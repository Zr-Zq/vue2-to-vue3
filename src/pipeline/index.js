const { createRegistry } = require('./registry')
const { registerBuiltins } = require('./plugins')
const {
  loadPipelineConfig,
  applyCliWriteMode,
  DEFAULT_PIPELINE,
  DEFAULT_PREFLIGHT_PIPELINE,
  DEFAULT_CONFIG,
} = require('./load-config')
const { runPipeline } = require('./runner')
const { createFileContext, createProjectContext } = require('./context')
const { createPlugin } = require('./create-plugin')
const { writeAnalyze, loadProjectGraph } = require('../write-analyze')

/**
 * Create a registry with built-in plugins registered.
 */
function createDefaultRegistry() {
  return registerBuiltins(createRegistry())
}

/**
 * Main entry: load config → read/write project .v23 analysis → run pipeline in order.
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
    // No existing analysis: write project .v23 for later plugin lookup
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
  applyCliWriteMode,
  DEFAULT_PIPELINE,
  DEFAULT_PREFLIGHT_PIPELINE,
  DEFAULT_CONFIG,
  runPipeline,
  run,
  registerBuiltins,
}

const fs = require('fs')
const path = require('path')
const { buildGraph } = require('./build-graph')
const { renderHtmlReport } = require('./report-html')
const {
  ensureProjectWorkDir,
  projectGraphPath,
  projectWorkDir,
  outputPath,
} = require('./paths')

function slimForJson(graph) {
  const files = (graph.files || []).map((f) => {
    const copy = Object.assign({}, f)
    delete copy.absPath
    return copy
  })
  return Object.assign({}, graph, { files })
}

/**
 * Analyze and write in-project .v23/graph.json (consumed by the pipeline)
 * Optional: copy HTML report to repo output/ for human review
 */
function writeAnalyze(projectRoot, options) {
  const opts = options || {}
  const root = path.resolve(projectRoot)
  const workDir = ensureProjectWorkDir(root)
  const graph = opts.graph || buildGraph(root)
  const slim = slimForJson(graph)

  const graphPath = projectGraphPath(root)
  fs.writeFileSync(graphPath, JSON.stringify(slim, null, 2), 'utf8')

  const metaPath = path.join(workDir, 'meta.json')
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        projectRoot: root,
        analyzedAt: slim.meta && slim.meta.analyzedAt,
        stats: slim.stats,
        graph: 'graph.json',
      },
      null,
      2
    ),
    'utf8'
  )

  let htmlPath = null
  if (opts.html !== false) {
    // HTML is for review only: also stored under .v23 by default; cleaned after full run
    htmlPath = path.join(workDir, 'index.html')
    fs.writeFileSync(htmlPath, renderHtmlReport(slim), 'utf8')
  }

  // Optional extra copy to repo output (still cleanable via clean:output)
  if (opts.copyReport) {
    const reportDir = outputPath(path.basename(root) + '-analyze')
    fs.mkdirSync(reportDir, { recursive: true })
    fs.copyFileSync(graphPath, path.join(reportDir, 'graph.json'))
    if (htmlPath) fs.copyFileSync(htmlPath, path.join(reportDir, 'index.html'))
  }

  return {
    workDir: projectWorkDir(root),
    graphPath,
    htmlPath,
    graph: slim,
  }
}

function loadProjectGraph(projectRoot) {
  const graphPath = projectGraphPath(projectRoot)
  if (!fs.existsSync(graphPath)) return null
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'))
}

module.exports = {
  slimForJson,
  writeAnalyze,
  loadProjectGraph,
}

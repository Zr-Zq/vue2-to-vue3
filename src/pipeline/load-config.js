const fs = require('fs')
const path = require('path')
const { STREAMS } = require('../handoff')

/**
 * Preflight pipeline split into HTML stream / JS stream (plus risk registration).
 * - HTML: rewrite template/style only; write .v23/handoff.json when JS depends on it
 * - JS: rewrite script; consume handoff; skip if not found
 * Categories already handled by scripts are no longer treated as risks
 * (see docs/cannot-fully-auto.md).
 */
const HTML_STREAM = STREAMS.html.plugins.map((name) => ({
  name,
  enabled: true,
  stream: 'html',
}))

const JS_STREAM = STREAMS.js.plugins.map((name) => ({
  name,
  enabled: true,
  stream: 'js',
}))

const RISK_STREAM = [
  { name: 'risk-instance-api' },
  { name: 'risk-props-mutation' },
  { name: 'risk-directives' },
  { name: 'risk-functional-render' },
  { name: 'risk-setup-mix' },
  { name: 'risk-template-quirks' },
  { name: 'risk-keepalive-combo' },
  { name: 'risk-provide-primitive' },
  { name: 'risk-globals-extend' },
  { name: 'risk-mixin-collision' },
  { name: 'risk-options-composition' },
  { name: 'risk-annotate' },
  { name: 'risk-summary' },
]

/** Full preflight: HTML to JS to risk */
const DEFAULT_PREFLIGHT_PIPELINE = [].concat(HTML_STREAM, JS_STREAM, RISK_STREAM)

/** HTML-only preview stream (filter handoff left for a later JS stream) */
const HTML_ONLY_PREFLIGHT = [].concat(HTML_STREAM, [
  { name: 'risk-template-quirks' },
  { name: 'risk-keepalive-combo' },
  { name: 'risk-functional-render' },
  { name: 'risk-annotate', enabled: false },
  { name: 'risk-summary' },
])

/** JS-only stream (reads .v23/handoff.json) */
const JS_ONLY_PREFLIGHT = [].concat(JS_STREAM, [
  { name: 'risk-annotate', enabled: false },
  { name: 'risk-summary' },
])

/**
 * Migration rewrite pipeline (pluggable; migrate stages may also appear in
 * preflight — registry forbids duplicate names, so skip if already run).
 */
const DEFAULT_PIPELINE = [
  { name: 'scss', enabled: true },
  { name: 'less', enabled: true },
  { name: 'typescript', enabled: true },
  { name: 'vuex', enabled: true },
  { name: 'router', enabled: true },
  { name: 'i18n', enabled: true },
  { name: 'element', enabled: true },
]

const DEFAULT_CONFIG = {
  /** Preflight risk pipeline; set [] to skip */
  preflightPipeline: DEFAULT_PREFLIGHT_PIPELINE,
  /** Migration pipeline order */
  pipeline: DEFAULT_PIPELINE,
  // src + root-level sidecar dirs (script/test/style/mock…); plugins without a Vue stack skip naturally
  include: ['src/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css}'].concat(
    require('../sidecar-dirs').sidecarIncludeGlobs()
  ),
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.v23/**', '**/v23-preflight/**'],
  /** dryRun: analyze/report only, do not write files */
  dryRun: true,
  /** Output directory; null means in-place (when not dryRun) */
  outDir: null,
  /** Whether to run graph analysis first and inject project.graph */
  preflight: true,
  pluginOptions: {},
}

function loadPipelineConfig(projectRoot, explicitPath) {
  const root = path.resolve(projectRoot)
  const candidates = explicitPath
    ? [path.resolve(explicitPath)]
    : [
        path.join(root, 'v23.pipeline.js'),
        path.join(root, 'v23.pipeline.cjs'),
        path.join(root, 'v23.pipeline.json'),
        path.join(root, 'pipeline.config.js'),
      ]

  let user = {}
  let loadedFrom = null
  for (let i = 0; i < candidates.length; i += 1) {
    const p = candidates[i]
    if (!fs.existsSync(p)) continue
    loadedFrom = p
    if (p.endsWith('.json')) {
      user = JSON.parse(fs.readFileSync(p, 'utf8'))
    } else {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(p)
      user = typeof mod === 'function' ? mod() : mod
    }
    break
  }

  const merged = Object.assign({}, DEFAULT_CONFIG, user || {})
  // Allow preset names: 'html-only' | 'js-only' | 'full'
  if (typeof merged.preflightPipeline === 'string') {
    const preset = merged.preflightPipeline
    if (preset === 'html-only') merged.preflightPipeline = HTML_ONLY_PREFLIGHT.slice()
    else if (preset === 'js-only') merged.preflightPipeline = JS_ONLY_PREFLIGHT.slice()
    else if (preset === 'full') merged.preflightPipeline = DEFAULT_PREFLIGHT_PIPELINE.slice()
  }
  merged.__root = root
  merged.__loadedFrom = loadedFrom
  return merged
}

/**
 * In-place writes require an explicit CLI `--write`.
 * `v23.pipeline.js` `dryRun: false` must not rewrite the project by itself.
 * `--out` still targets that directory only (sources stay put unless `--write`).
 */
function applyCliWriteMode(config, opts) {
  const write = !!(opts && opts.write)
  const outDir = opts && opts.outDir
  if (write) config.dryRun = false
  else if (!outDir) config.dryRun = true
  return config
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_PREFLIGHT_PIPELINE,
  DEFAULT_PIPELINE,
  HTML_STREAM,
  JS_STREAM,
  RISK_STREAM,
  HTML_ONLY_PREFLIGHT,
  JS_ONLY_PREFLIGHT,
  loadPipelineConfig,
  applyCliWriteMode,
}

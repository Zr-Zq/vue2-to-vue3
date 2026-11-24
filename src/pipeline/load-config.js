const fs = require('fs')
const path = require('path')
const { STREAMS } = require('../handoff')

/**
 * 前置流水线拆成 HTML 流 / JS 流（再加风险登记）。
 * - HTML：只改 template/style；与 JS 有依赖时写 .v23/handoff.json
 * - JS：改 script；消费 handoff，找不到则 skip
 * 已脚本处理的类不再当危险（见 docs/cannot-fully-auto.md）。
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
  { name: 'risk-annotate' },
  { name: 'risk-summary' },
]

/** 完整前置：HTML → JS → 风险 */
const DEFAULT_PREFLIGHT_PIPELINE = [].concat(HTML_STREAM, JS_STREAM, RISK_STREAM)

/** 仅 HTML 预览流（filter 交接留给后续 JS 流） */
const HTML_ONLY_PREFLIGHT = [].concat(HTML_STREAM, [
  { name: 'risk-template-quirks' },
  { name: 'risk-keepalive-combo' },
  { name: 'risk-functional-render' },
  { name: 'risk-annotate', enabled: false },
  { name: 'risk-summary' },
])

/** 仅 JS 流（会读 .v23/handoff.json） */
const JS_ONLY_PREFLIGHT = [].concat(JS_STREAM, [
  { name: 'risk-annotate', enabled: false },
  { name: 'risk-summary' },
])

/** 迁移改写流水线（可插拔；与 preflight 中 migrate 可重复配置，registry 禁止同名则 preflight 已跑过即可） */
const DEFAULT_PIPELINE = [
  { name: 'scss', enabled: true },
  { name: 'less', enabled: true },
  { name: 'typescript', enabled: true },
  { name: 'vuex', enabled: true },
  { name: 'router', enabled: true },
  { name: 'element', enabled: true },
]

const DEFAULT_CONFIG = {
  /** 前置风险流水线；设为 [] 可跳过 */
  preflightPipeline: DEFAULT_PREFLIGHT_PIPELINE,
  /** 迁移流水线顺序 */
  pipeline: DEFAULT_PIPELINE,
  // src + 根级旁路目录（script/test/style/mock…）；无 Vue 栈的文件插件会自然 skip
  include: ['src/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css}'].concat(
    require('../sidecar-dirs').sidecarIncludeGlobs()
  ),
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.v23/**', '**/v23-preflight/**'],
  /** dryRun: 只分析/报告不写文件 */
  dryRun: true,
  /** 写出目录；null 表示原地（非 dryRun 时） */
  outDir: null,
  /** 是否先跑 graph 分析并注入 project.graph */
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
  // 允许用预设名：'html-only' | 'js-only' | 'full'
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
}

/**
 * 项目根下「独立旁路目录」：script / test / style 等，不在默认 src 内。
 * - copy：存在则整目录拷到底座同名路径
 * - pipeline：纳入扫描；若文件无 Vue/Element/Router/Vuex 用法，插件通常自然 no-op
 *
 * 绝不迁：node_modules / dist / 构建产物 / VCS / 工具缓存（见 SIDECAR_NEVER_COPY）
 */
const fs = require('fs')
const path = require('path')

/**
 * 硬排除：即使误写进白名单也不拷、不扫
 * （依赖、构建输出、版本控制、本工具工作区等）
 */
const SIDECAR_NEVER_COPY = new Set(
  [
    'node_modules',
    'dist',
    'build',
    'out',
    'output',
    'coverage',
    '.git',
    '.svn',
    '.hg',
    '.v23',
    '.turbo',
    '.cache',
    '.next',
    '.nuxt',
    '.output',
    'tmp',
    'temp',
  ].map((s) => s.toLowerCase())
)

/** 常见根级旁路目录名（白名单；与 NEVER 交集会被滤掉） */
const SIDECAR_DIR_NAMES = [
  'script',
  'scripts',
  'test',
  'tests',
  '__tests__',
  'style',
  'styles',
  'mock',
  'mocks',
  'docs',
  'doc',
  'static',
  'lib',
  'libs',
  'vendor',
  'vendors',
  'cdn',
  'assets', // 仅当与 src/assets 并列的根级 assets
].filter((name) => !SIDECAR_NEVER_COPY.has(name.toLowerCase()))

function isNeverCopyDir(name) {
  return SIDECAR_NEVER_COPY.has(String(name || '').toLowerCase())
}

/**
 * 列出源根下实际存在的旁路目录（相对名）；永不返回 node_modules/dist 等
 */
function listSidecarDirs(projectRoot) {
  const root = path.resolve(projectRoot)
  if (!fs.existsSync(root)) return []
  const names = []
  SIDECAR_DIR_NAMES.forEach((name) => {
    if (isNeverCopyDir(name)) return
    const abs = path.join(root, name)
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) names.push(name)
  })
  return names
}

/**
 * 粗判文本是否像 Vue 技术栈（用于 AI/报告；流水线仍可扫全量）
 */
function looksLikeVueStack(code) {
  const s = String(code || '')
  return (
    /\bvue\b/i.test(s) ||
    /\belement-ui\b/i.test(s) ||
    /\belement-plus\b/i.test(s) ||
    /\bvue-router\b/i.test(s) ||
    /\bvuex\b/i.test(s) ||
    /\bpinia\b/i.test(s) ||
    /\bnew\s+Vue\b/.test(s) ||
    /\bVue\.(use|component|mixin|filter|prototype)\b/.test(s) ||
    /from\s+['"]vue['"]/.test(s) ||
    /<template[\s>]/i.test(s)
  )
}

/** 流水线额外 include glob（相对项目根）；排除 NEVER 目录 */
function sidecarIncludeGlobs() {
  return SIDECAR_DIR_NAMES.filter((d) => !isNeverCopyDir(d)).map(
    (d) => d + '/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css,html}'
  )
}

/** copy 树内 ignore（嵌套的 node_modules/dist 也不跟） */
function sidecarCopyIgnoreGlobs() {
  return [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.git/**',
    '**/.v23/**',
  ]
}

module.exports = {
  SIDECAR_DIR_NAMES,
  SIDECAR_NEVER_COPY,
  isNeverCopyDir,
  listSidecarDirs,
  looksLikeVueStack,
  sidecarIncludeGlobs,
  sidecarCopyIgnoreGlobs,
}

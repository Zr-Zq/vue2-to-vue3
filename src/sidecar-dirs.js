/**
 * Root-level sidecar dirs (script / test / style, …) outside default `src`.
 * - copy: if present, copy the whole tree to the same name under the target
 * - pipeline: include in scan; files without Vue/Element/Router/Vuex usually no-op
 *
 * Never migrate: node_modules / dist / build artifacts / VCS / tool caches
 * (see SIDECAR_NEVER_COPY).
 */
const fs = require('fs')
const path = require('path')

/**
 * Hard denylist: never copy or scan even if mistakenly whitelisted
 * (deps, build output, VCS, this tool's workdir, caches).
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

/** Common root sidecar names (whitelist; intersect NEVER is filtered out). */
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
  'assets', // root-level assets only when sibling to src/assets
].filter((name) => !SIDECAR_NEVER_COPY.has(name.toLowerCase()))

function isNeverCopyDir(name) {
  return SIDECAR_NEVER_COPY.has(String(name || '').toLowerCase())
}

/**
 * List sidecar dirs that actually exist under the project root (relative names).
 * Never returns node_modules/dist/etc.
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
 * Heuristic: does text look like a Vue stack? (for AI/reports; pipeline may still scan all)
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

/** Extra pipeline include globs (relative to project root); NEVER dirs excluded. */
function sidecarIncludeGlobs() {
  return SIDECAR_DIR_NAMES.filter((d) => !isNeverCopyDir(d)).map(
    (d) => d + '/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css,html}'
  )
}

/** Ignore globs when copying a sidecar tree (nested node_modules/dist too). */
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

const path = require('path')
const fs = require('fs')

const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.json', '.mjs', '.cjs']

function loadProjectConfig(projectRoot) {
  const root = path.resolve(projectRoot)
  const pkgPath = path.join(root, 'package.json')
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {}

  const alias = {
    '@': path.join(root, 'src'),
    '~': path.join(root, 'src'),
  }

  // jsconfig / tsconfig paths
  ;['jsconfig.json', 'tsconfig.json'].forEach((name) => {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) return
    try {
      const jc = JSON.parse(fs.readFileSync(p, 'utf8').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'))
      const paths = (jc.compilerOptions && jc.compilerOptions.paths) || {}
      const baseUrl = (jc.compilerOptions && jc.compilerOptions.baseUrl) || '.'
      Object.keys(paths).forEach((key) => {
        const target = paths[key][0]
        if (!target) return
        const cleanKey = key.replace(/\/\*$/, '')
        const cleanTarget = target.replace(/\/\*$/, '')
        alias[cleanKey] = path.resolve(root, baseUrl, cleanTarget)
      })
    } catch (e) {
      /* ignore */
    }
  })

  // Extract alias from webpack.config.js text (do not execute the config)
  const webpackPath = path.join(root, 'webpack.config.js')
  if (fs.existsSync(webpackPath)) {
    try {
      const text = fs.readFileSync(webpackPath, 'utf8')
      // '@': resolve('src') / "@": path.resolve(__dirname, 'src')
      const re = /['"](@|~)['"]\s*:\s*(?:resolve\(['"]([^'"]+)['"]\)|path\.resolve\([^)]*['"]([^'"]+)['"]\))/g
      let m
      while ((m = re.exec(text))) {
        const key = m[1]
        const target = m[2] || m[3]
        if (target) alias[key] = path.resolve(root, target)
      }
    } catch (e) {
      /* ignore */
    }
  }

  return {
    root,
    alias,
    extensions: DEFAULT_EXTENSIONS,
    include: ['src/**/*.{js,jsx,ts,tsx,vue,mjs,cjs}'].concat(
      require('./sidecar-dirs').sidecarIncludeGlobs()
    ),
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.v23/**'],
    packageName: pkg.name || path.basename(root),
  }
}

module.exports = {
  DEFAULT_EXTENSIONS,
  loadProjectConfig,
}

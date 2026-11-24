const fs = require('fs')
const path = require('path')

const MARKERS = [
  'package.json',
  'jsconfig.json',
  'tsconfig.json',
  'webpack.config.js',
  'vite.config.js',
  'vite.config.ts',
  'vue.config.js',
]

/**
 * 从文件或目录向上找项目根（含 package.json 或路径配置文件）
 */
function detectProjectRoot(startPath) {
  let cur = path.resolve(startPath)
  if (fs.existsSync(cur) && fs.statSync(cur).isFile()) {
    cur = path.dirname(cur)
  }
  const roots = []
  while (true) {
    const hits = MARKERS.filter((m) => fs.existsSync(path.join(cur, m)))
    if (hits.includes('package.json') || hits.length >= 1) {
      roots.push({ root: cur, markers: hits })
      // 优先带 package.json 的最近层
      if (hits.includes('package.json')) return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return roots.length ? roots[0].root : null
}

module.exports = {
  detectProjectRoot,
  MARKERS,
}

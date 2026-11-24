/**
 * 2to3 默认流水线配置（可复制到目标项目为 v23.pipeline.js）
 *
 * - 数组顺序 = 执行顺序
 * - enabled: false 关闭某插件
 * - use: 外部文件路径实现热插拔
 * - options.mode: detect | annotate
 */
module.exports = {
  dryRun: true,
  preflight: true,
  outDir: null,
  pipeline: [
    { name: 'scss', enabled: true, options: { mode: 'detect' } },
    { name: 'less', enabled: true, options: { mode: 'detect' } },
    { name: 'typescript', enabled: true, options: { mode: 'detect' } },
    { name: 'vuex', enabled: true, options: { mode: 'detect' } },
    { name: 'router', enabled: true, options: { mode: 'detect' } },
    { name: 'element', enabled: true, options: { mode: 'detect' } },
    // 热插拔示例（默认关）：
    // { use: './examples/plugins/hello-plugin.js', enabled: true, options: { mode: 'detect' } },
  ],
  include: ['src/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css}'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
}

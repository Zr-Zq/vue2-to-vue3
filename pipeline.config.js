/**
 * 2to3 default pipeline config (copy into the target project as v23.pipeline.js)
 *
 * - Array order = execution order
 * - enabled: false disables a plugin
 * - use: external file path for hot-plugging
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
    { name: 'element', enabled: true, options: { mode: 'migrate' } },
    // Hot-plug example (off by default):
    // { use: './examples/plugins/hello-plugin.js', enabled: true, options: { mode: 'detect' } },
  ],
  include: ['src/**/*.{js,jsx,ts,tsx,vue,mjs,cjs,scss,sass,less,css}'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
}

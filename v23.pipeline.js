/**
 * my-vue-app migration pipeline config
 * Order is adjustable; enabled is a hot switch; use can load external plugins
 */
module.exports = {
  dryRun: true,
  preflight: true,
  pipeline: [
    { name: 'scss' },
    { name: 'less', enabled: false }, // Project rarely uses less; disabled
    { name: 'typescript' },
    { name: 'vuex' },
    { name: 'router' },
    { name: 'element' },
  ],
}

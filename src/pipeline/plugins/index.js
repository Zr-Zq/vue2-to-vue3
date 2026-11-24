const scss = require('./scss')
const less = require('./less')
const typescript = require('./typescript')
const vuex = require('./vuex')
const router = require('./router')
const element = require('./element')

const riskInstanceApi = require('./risk-instance-api')
const riskPropsMutation = require('./risk-props-mutation')
const riskDirectives = require('./risk-directives')
const riskFunctionalRender = require('./risk-functional-render')
const riskSetupMix = require('./risk-setup-mix')
const riskTemplateQuirks = require('./risk-template-quirks')
const riskKeepaliveCombo = require('./risk-keepalive-combo')
const riskProvidePrimitive = require('./risk-provide-primitive')
const riskGlobalsExtend = require('./risk-globals-extend')
const riskMixinCollision = require('./risk-mixin-collision')
const riskAnnotate = require('./risk-annotate')
const riskSummary = require('./risk-summary')

const migrateHtml = require('./migrate-html')
const migrateRenderH = require('./migrate-render-h')
const migrateApiCompat = require('./migrate-api-compat')
const migrateDirectiveHooks = require('./migrate-directive-hooks')
const migrateFilters = require('./migrate-filters')
const migrateDeep = require('./migrate-deep')
const migrateFunctional = require('./migrate-functional')
const migrateMount = require('./migrate-mount')
const migrateExtend = require('./migrate-extend')
const migrateChildren = require('./migrate-children')
const migrateInstanceEvents = require('./migrate-instance-events')

/** Deterministic script rewrites: run before risk detection so these are no longer "risks" */
const migratePlugins = [
  migrateHtml,
  migrateRenderH,
  migrateApiCompat,
  migrateDirectiveHooks,
  migrateFilters,
  migrateDeep,
  migrateFunctional,
  migrateExtend,
  migrateMount,
  migrateChildren,
  migrateInstanceEvents,
]

const riskPlugins = [
  riskInstanceApi,
  riskPropsMutation,
  riskDirectives,
  riskFunctionalRender,
  riskSetupMix,
  riskTemplateQuirks,
  riskKeepaliveCombo,
  riskProvidePrimitive,
  riskGlobalsExtend,
  riskMixinCollision,
  riskAnnotate,
  riskSummary,
]

const transformPlugins = migratePlugins.concat([
  scss,
  less,
  typescript,
  vuex,
  router,
  element,
])

const builtins = riskPlugins.concat(transformPlugins)

function registerBuiltins(registry) {
  builtins.forEach((p) => registry.register(p))
  return registry
}

module.exports = {
  builtins,
  riskPlugins,
  transformPlugins,
  registerBuiltins,
  migrateHtml,
  migrateRenderH,
  migrateApiCompat,
  migrateDirectiveHooks,
  migrateFilters,
  migrateDeep,
  migrateFunctional,
  migrateExtend,
  migrateMount,
  migrateChildren,
  migrateInstanceEvents,
  scss,
  less,
  typescript,
  vuex,
  router,
  element,
}

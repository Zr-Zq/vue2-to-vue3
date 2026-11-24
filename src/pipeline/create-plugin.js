/**
 * 规范化插件定义，保证热插拔接口一致。
 *
 * @typedef {object} PipelinePlugin
 * @property {string} name
 * @property {string} [description]
 * @property {string} [version]
 * @property {(projectCtx, api) => void|Promise<void>} [setup]
 * @property {(fileCtx) => boolean} [match]  默认 true
 * @property {(fileCtx, api) => void|Promise<void>} [transform]
 * @property {(projectCtx, api) => void|Promise<void>} [teardown]
 * @property {object} [defaults] 默认 options
 */

function createPlugin(def) {
  if (!def || !def.name) {
    throw new Error('plugin 必须有 name')
  }
  return {
    name: def.name,
    description: def.description || '',
    version: def.version || '0.0.0',
    defaults: def.defaults || {},
    setup: typeof def.setup === 'function' ? def.setup : async () => {},
    match: typeof def.match === 'function' ? def.match : () => true,
    transform: typeof def.transform === 'function' ? def.transform : async () => {},
    teardown: typeof def.teardown === 'function' ? def.teardown : async () => {},
  }
}

module.exports = {
  createPlugin,
}

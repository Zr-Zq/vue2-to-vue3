const path = require('path')
const { createPlugin } = require('./create-plugin')

/**
 * 插件注册表：内置 + 外部路径热插拔
 */
function createRegistry() {
  const builtins = new Map()

  function register(pluginOrFactory) {
    const raw = typeof pluginOrFactory === 'function' ? pluginOrFactory() : pluginOrFactory
    const plugin = createPlugin(raw)
    builtins.set(plugin.name, plugin)
    return plugin
  }

  function get(name) {
    return builtins.get(name) || null
  }

  function list() {
    return Array.from(builtins.values()).map((p) => ({
      name: p.name,
      description: p.description,
      version: p.version,
    }))
  }

  /**
   * 解析配置项为 { plugin, options, enabled }
   * 支持：
   * - 'scss'
   * - { name: 'scss', enabled: false, options: {} }
   * - { use: './plugins/my.js', options: {} }  外部热插拔
   * - { use: requireable, name?, options? }
   */
  function resolveEntry(entry, fromDir) {
    if (typeof entry === 'string') {
      if (entry.startsWith('.') || entry.startsWith('/') || path.isAbsolute(entry)) {
        return loadExternal(entry, fromDir, {})
      }
      const plugin = get(entry)
      if (!plugin) throw new Error('未知内置插件: ' + entry + '；可用: ' + list().map((x) => x.name).join(', '))
      return { plugin, options: {}, enabled: true }
    }

    if (!entry || typeof entry !== 'object') {
      throw new Error('非法插件配置: ' + String(entry))
    }

    const enabled = entry.enabled !== false
    const options = entry.options || {}

    if (entry.use) {
      const loaded = loadExternal(entry.use, fromDir, options, entry.name)
      loaded.enabled = enabled
      loaded.options = Object.assign({}, loaded.options, options)
      return loaded
    }

    if (!entry.name) throw new Error('插件配置缺少 name 或 use')
    const plugin = get(entry.name)
    if (!plugin) throw new Error('未知内置插件: ' + entry.name)
    return { plugin, options, enabled }
  }

  function loadExternal(spec, fromDir, options, nameOverride) {
    let mod
    if (typeof spec === 'function' || (spec && spec.transform)) {
      mod = spec
    } else {
      const resolved = path.isAbsolute(spec) ? spec : path.resolve(fromDir || process.cwd(), spec)
      // eslint-disable-next-line import/no-dynamic-require, global-require
      mod = require(resolved)
    }
    const raw = mod.default || mod.plugin || mod
    const plugin = createPlugin(typeof raw === 'function' ? raw(options) : raw)
    if (nameOverride) plugin.name = nameOverride
    return { plugin, options: options || {}, enabled: true }
  }

  /**
   * 按配置顺序展开启用的插件链
   */
  function resolvePipeline(pipelineConfig, fromDir) {
    const stages = []
    const seen = new Set()
    ;(pipelineConfig || []).forEach((entry, idx) => {
      const resolved = resolveEntry(entry, fromDir)
      if (!resolved.enabled) return
      const name = resolved.plugin.name
      if (seen.has(name)) {
        // 允许同名？默认禁止，避免顺序混乱
        throw new Error('流水线中重复插件: ' + name + ' @#' + idx)
      }
      seen.add(name)
      stages.push({
        name,
        plugin: resolved.plugin,
        options: Object.assign({}, resolved.plugin.defaults || {}, resolved.options || {}),
        index: stages.length,
      })
    })
    return stages
  }

  return {
    register,
    get,
    list,
    resolveEntry,
    resolvePipeline,
  }
}

module.exports = {
  createRegistry,
}

const path = require('path')
const { createPlugin } = require('./create-plugin')

/**
 * Plugin registry: builtins + external path hot-plug.
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
   * Resolve a config entry to { plugin, options, enabled }.
   * Supports:
   * - 'scss'
   * - { name: 'scss', enabled: false, options: {} }
   * - { use: './plugins/my.js', options: {} }  external hot-plug
   * - { use: requireable, name?, options? }
   */
  function resolveEntry(entry, fromDir) {
    if (typeof entry === 'string') {
      if (entry.startsWith('.') || entry.startsWith('/') || path.isAbsolute(entry)) {
        return loadExternal(entry, fromDir, {})
      }
      const plugin = get(entry)
      if (!plugin) throw new Error('Unknown built-in plugin: ' + entry + '; available: ' + list().map((x) => x.name).join(', '))
      return { plugin, options: {}, enabled: true }
    }

    if (!entry || typeof entry !== 'object') {
      throw new Error('Invalid plugin config: ' + String(entry))
    }

    const enabled = entry.enabled !== false
    const options = entry.options || {}

    if (entry.use) {
      const loaded = loadExternal(entry.use, fromDir, options, entry.name)
      loaded.enabled = enabled
      loaded.options = Object.assign({}, loaded.options, options)
      return loaded
    }

    if (!entry.name) throw new Error('plugin config missing name or use')
    const plugin = get(entry.name)
    if (!plugin) throw new Error('Unknown built-in plugin: ' + entry.name)
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
   * Expand the enabled plugin chain in config order.
   */
  function resolvePipeline(pipelineConfig, fromDir) {
    const stages = []
    const seen = new Set()
    ;(pipelineConfig || []).forEach((entry, idx) => {
      const resolved = resolveEntry(entry, fromDir)
      if (!resolved.enabled) return
      const name = resolved.plugin.name
      if (seen.has(name)) {
        // Allow duplicates? Default no — avoids ambiguous order
        throw new Error('Duplicate plugin in pipeline: ' + name + ' @#' + idx)
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

const fs = require('fs')
const path = require('path')

function fileExists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch (e) {
    return false
  }
}

function tryResolveFile(base, extensions) {
  if (fileExists(base)) return path.normalize(base)
  for (let i = 0; i < extensions.length; i += 1) {
    const withExt = base + extensions[i]
    if (fileExists(withExt)) return path.normalize(withExt)
  }
  for (let i = 0; i < extensions.length; i += 1) {
    const idx = path.join(base, 'index' + extensions[i])
    if (fileExists(idx)) return path.normalize(idx)
  }
  return null
}

/**
 * 解析导入路径到绝对文件路径；解析失败返回 null，并标记 external
 */
function resolveImport(specifier, fromFile, config) {
  if (!specifier || typeof specifier !== 'string') {
    return { resolved: null, external: true, kind: 'invalid' }
  }

  // 裸模块 / http
  if (/^(https?:)?\/\//.test(specifier) || specifier.startsWith('data:')) {
    return { resolved: null, external: true, kind: 'url', specifier }
  }

  let candidate = specifier

  // alias
  const aliasKeys = Object.keys(config.alias || {}).sort((a, b) => b.length - a.length)
  for (let i = 0; i < aliasKeys.length; i += 1) {
    const key = aliasKeys[i]
    if (specifier === key || specifier.startsWith(key + '/')) {
      candidate = path.join(config.alias[key], specifier.slice(key.length))
      break
    }
  }

  if (candidate === specifier) {
    if (specifier.startsWith('.') || specifier.startsWith('/') || path.isAbsolute(specifier)) {
      candidate = path.isAbsolute(specifier)
        ? specifier
        : path.resolve(path.dirname(fromFile), specifier)
    } else {
      // node_modules bare import
      return { resolved: null, external: true, kind: 'package', specifier }
    }
  }

  const resolved = tryResolveFile(candidate, config.extensions)
  if (!resolved) {
    return { resolved: null, external: true, kind: 'unresolved', specifier, tried: candidate }
  }

  return { resolved, external: false, kind: 'file', specifier }
}

function toPosixRel(absPath, root) {
  const rel = path.relative(root, absPath)
  return rel.split(path.sep).join('/')
}

module.exports = {
  resolveImport,
  toPosixRel,
  tryResolveFile,
}

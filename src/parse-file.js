const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const { decomposeVue } = require('./sfc-parts')

const BABEL_PLUGINS = [
  'jsx',
  'typescript',
  'classProperties',
  'decorators-legacy',
  'objectRestSpread',
  'dynamicImport',
  'optionalChaining',
  'nullishCoalescingOperator',
  'exportDefaultFrom',
  'exportNamespaceFrom',
]

function parseJs(code, filename) {
  return parser.parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins: BABEL_PLUGINS,
    sourceFilename: filename,
  })
}

/**
 * Vue: split into html(template) + js(script); babel only for real script code.
 * Plain .js/.ts: whole file goes through js.
 *
 * @returns {{
 *   kind: 'js'|'vue',
 *   scripts: Array<object>,
 *   template: object|null,
 *   htmlParts: object[],
 *   jsParts: object[],
 *   skippedScripts: object[],
 *   errors: string[],
 *   raw: string,
 * }}
 */
function parseProjectFile(absPath) {
  const code = fs.readFileSync(absPath, 'utf8')
  const ext = path.extname(absPath).toLowerCase()
  const errors = []

  if (ext === '.vue') {
    const parts = decomposeVue(code, absPath)
    errors.push(...(parts.errors || []))

    const scripts = []
    ;(parts.scripts || []).forEach((entry) => {
      let ast = null
      if (entry.isRealCode) {
        try {
          ast = parseJs(entry.code, absPath + '?' + entry.id)
        } catch (e) {
          errors.push(entry.id + ' parse: ' + e.message)
        }
      }
      scripts.push({
        id: entry.id,
        code: entry.code,
        ast,
        lang: entry.lang,
        setup: entry.setup,
        isRealCode: !!entry.isRealCode,
        skipReason: entry.skipReason || null,
        range: entry.range || null,
        kind: 'js',
      })
    })

    return {
      kind: 'vue',
      scripts,
      template: parts.template,
      htmlParts: parts.htmlParts || [],
      jsParts: (parts.jsParts || []).map((p) => {
        const matched = scripts.find((s) => s.id === p.id)
        return Object.assign({}, p, { ast: matched ? matched.ast : null })
      }),
      skippedScripts: parts.skippedScripts || [],
      styles: parts.styles || [],
      errors,
      raw: code,
    }
  }

  let ast = null
  try {
    ast = parseJs(code, absPath)
  } catch (e) {
    errors.push('js parse: ' + e.message)
  }
  const script = {
    id: 'module',
    code,
    ast,
    lang: ext.replace('.', '') || 'js',
    setup: false,
    isRealCode: true,
    skipReason: null,
    range: null,
    kind: 'js',
  }
  return {
    kind: 'js',
    scripts: [script],
    template: null,
    htmlParts: [],
    jsParts: [script],
    skippedScripts: [],
    styles: [],
    errors,
    raw: code,
  }
}

/**
 * Parse from existing content (need not be on disk); for pipeline current content
 */
function parseProjectSource(code, absPath) {
  const ext = path.extname(absPath || '').toLowerCase()
  const errors = []
  if (ext === '.vue') {
    const parts = decomposeVue(code, absPath)
    errors.push(...(parts.errors || []))
    const scripts = (parts.scripts || []).map((entry) => {
      let ast = null
      if (entry.isRealCode) {
        try {
          ast = parseJs(entry.code, (absPath || 'anon.vue') + '?' + entry.id)
        } catch (e) {
          errors.push(entry.id + ' parse: ' + e.message)
        }
      }
      return {
        id: entry.id,
        code: entry.code,
        ast,
        lang: entry.lang,
        setup: entry.setup,
        isRealCode: !!entry.isRealCode,
        skipReason: entry.skipReason || null,
        range: entry.range || null,
        kind: 'js',
      }
    })
    return {
      kind: 'vue',
      scripts,
      template: parts.template,
      htmlParts: parts.htmlParts || [],
      jsParts: scripts.filter((s) => s.isRealCode),
      skippedScripts: scripts.filter((s) => !s.isRealCode),
      styles: parts.styles || [],
      errors,
      raw: String(code || ''),
    }
  }

  let ast = null
  try {
    ast = parseJs(code, absPath || 'anon.js')
  } catch (e) {
    errors.push('js parse: ' + e.message)
  }
  const script = {
    id: 'module',
    code: String(code || ''),
    ast,
    lang: (ext || '.js').replace('.', '') || 'js',
    setup: false,
    isRealCode: true,
    skipReason: null,
    range: null,
    kind: 'js',
  }
  return {
    kind: 'js',
    scripts: [script],
    template: null,
    htmlParts: [],
    jsParts: [script],
    skippedScripts: [],
    styles: [],
    errors,
    raw: String(code || ''),
  }
}

module.exports = {
  parseProjectFile,
  parseProjectSource,
  parseJs,
}

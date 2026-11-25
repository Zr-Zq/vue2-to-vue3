#!/usr/bin/env node
/**
 * Wrap-up syntax check for a migrated project.
 * JSON (strict; tsconfig/jsconfig allow comments), JS/TS parse, Vue script parse.
 * Declaration / identifier failures are reported as kind "binding".
 *
 *   node scripts/check-syntax.js <projectRoot> --json [--files-from list] [--all]
 *   node scripts/check-syntax.js --self-test
 *
 * Exit 0 when ok, 1 when issues remain.
 */
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const parser = require('@babel/parser')
const { decomposeVue } = require('../src/sfc-parts')
const { listSidecarDirs } = require('../src/sidecar-dirs')

const BABEL_PLUGINS = [
  'jsx',
  'typescript',
  'classProperties',
  'decorators-legacy',
  'objectRestSpread',
  'dynamicImport',
  'optionalChaining',
  'nullishCoalescingOperator',
]

const CODE_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.json'])

const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.v23/**',
]

function lineAt(text, index) {
  let line = 1
  const n = Math.min(index, text.length)
  for (let i = 0; i < n; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function jsonErrorLine(text, err) {
  const msg = err && err.message ? err.message : String(err)
  const pos = /position\s+(\d+)/.exec(msg)
  if (pos) return lineAt(text, Number(pos[1]))
  const line = /line\s+(\d+)/i.exec(msg)
  if (line) return Number(line[1])
  return 1
}

function isJsoncName(rel) {
  const base = path.basename(rel).toLowerCase()
  return (
    base === 'tsconfig.json' ||
    base === 'jsconfig.json' ||
    base.startsWith('tsconfig.') ||
    base.startsWith('jsconfig.') ||
    base === '.eslintrc.json' ||
    base === '.babelrc.json'
  )
}

/** Strip // and block comments outside strings so tsconfig-style JSON can be parsed. */
function stripJsonc(text) {
  let out = ''
  let i = 0
  const s = text
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      const start = i
      i += 1
      while (i < s.length) {
        if (s[i] === '\\') {
          i += 2
          continue
        }
        if (s[i] === '"') {
          i += 1
          break
        }
        i += 1
      }
      out += s.slice(start, i)
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      i += 2
      while (i < s.length && s[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1
      i += 2
      out += ' '
      continue
    }
    out += c
    i += 1
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

function duplicateJsonKeys(text) {
  const issues = []
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let i = 0
  const n = s.length

  function skipWs() {
    while (i < n) {
      const c = s[i]
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i += 1
      else break
    }
  }

  function readString() {
    if (s[i] !== '"') return undefined
    const start = i
    i += 1
    while (i < n) {
      if (s[i] === '\\') {
        i += 2
        continue
      }
      if (s[i] === '"') {
        i += 1
        try {
          return JSON.parse(s.slice(start, i))
        } catch (e) {
          return undefined
        }
      }
      i += 1
    }
    return undefined
  }

  function parseValue() {
    skipWs()
    if (i >= n) return false
    const c = s[i]
    if (c === '{') return parseObject()
    if (c === '[') return parseArray()
    if (c === '"') {
      const v = readString()
      return v !== undefined || s[i - 1] === '"'
    }
    if (s.startsWith('true', i)) {
      i += 4
      return true
    }
    if (s.startsWith('false', i)) {
      i += 5
      return true
    }
    if (s.startsWith('null', i)) {
      i += 4
      return true
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(i))
      if (!m) return false
      i += m[0].length
      return true
    }
    return false
  }

  function parseArray() {
    i += 1
    skipWs()
    if (s[i] === ']') {
      i += 1
      return true
    }
    while (i < n) {
      if (!parseValue()) return false
      skipWs()
      if (s[i] === ',') {
        i += 1
        skipWs()
        continue
      }
      if (s[i] === ']') {
        i += 1
        return true
      }
      return false
    }
    return false
  }

  function parseObject() {
    i += 1
    const seen = new Set()
    skipWs()
    if (s[i] === '}') {
      i += 1
      return true
    }
    while (i < n) {
      skipWs()
      const keyPos = i
      const key = readString()
      if (key === undefined) return false
      if (seen.has(key)) issues.push({ key: String(key), line: lineAt(s, keyPos) })
      else seen.add(key)
      skipWs()
      if (s[i] !== ':') return false
      i += 1
      if (!parseValue()) return false
      skipWs()
      if (s[i] === ',') {
        i += 1
        continue
      }
      if (s[i] === '}') {
        i += 1
        return true
      }
      return false
    }
    return false
  }

  skipWs()
  const ok = parseValue()
  return ok ? issues : []
}

function checkJson(rel, text) {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const jsonc = isJsoncName(rel)
  try {
    JSON.parse(raw)
  } catch (e) {
    if (jsonc) {
      try {
        JSON.parse(stripJsonc(raw))
        return []
      } catch (e2) {
        return [
          {
            file: rel,
            line: jsonErrorLine(raw, e2),
            column: 1,
            kind: 'json',
            message: e2.message,
          },
        ]
      }
    }
    return [
      {
        file: rel,
        line: jsonErrorLine(raw, e),
        column: 1,
        kind: 'json',
        message: e.message,
      },
    ]
  }
  return duplicateJsonKeys(raw).map((d) => ({
    file: rel,
    line: d.line,
    column: 1,
    kind: 'json-duplicate-key',
    message: 'Duplicate JSON key "' + d.key + '"',
  }))
}

function bindingKind(message, text, loc) {
  if (
    /already been declared|not a valid identifier|reserved word|lexical declaration|const declaration|let declaration|var declaration|Missing initializer|Binding/i.test(
      message
    )
  ) {
    return 'binding'
  }
  if (loc && text && /Unexpected token|Unexpected identifier|Identifier expected/i.test(message)) {
    const line = String(text).split(/\n/)[(loc.line || 1) - 1] || ''
    if (/^\s*(const|let|var|class|function)\b/.test(line)) return 'binding'
  }
  return 'syntax'
}

function checkScript(rel, text, lineOffset) {
  const offset = lineOffset || 0
  try {
    parser.parse(String(text || ''), {
      sourceType: 'unambiguous',
      sourceFilename: rel,
      plugins: BABEL_PLUGINS,
      errorRecovery: false,
    })
    return []
  } catch (e) {
    const line = e.loc && e.loc.line ? e.loc.line + offset : 1 + offset
    const column = e.loc && e.loc.column != null ? e.loc.column + 1 : 1
    const message = e.message || String(e)
    return [
      {
        file: rel,
        line,
        column,
        kind: bindingKind(message, text, e.loc),
        message: message.split('\n')[0],
      },
    ]
  }
}

function checkVue(rel, text) {
  let parts
  try {
    parts = decomposeVue(text, rel)
  } catch (e) {
    return [
      {
        file: rel,
        line: 1,
        column: 1,
        kind: 'vue-sfc',
        message: e.message || String(e),
      },
    ]
  }
  if (!parts.descriptor && parts.errors && parts.errors.length) {
    return parts.errors.map((err) => ({
      file: rel,
      line: 1,
      column: 1,
      kind: 'vue-sfc',
      message: typeof err === 'string' ? err : err.message || String(err),
    }))
  }
  const issues = []
  ;(parts.jsParts || []).forEach((entry) => {
    const start = entry.range && typeof entry.range.startOffset === 'number' ? entry.range.startOffset : 0
    const offset = lineAt(text, start) - 1
    checkScript(rel, entry.code, offset).forEach((item) => issues.push(item))
  })
  return issues
}

function checkText(rel, text) {
  const file = String(rel || '').split(path.sep).join('/')
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') return checkJson(file, text)
  if (ext === '.vue') return checkVue(file, text)
  if (ext === '.d.ts') return []
  if (CODE_EXT.has(ext)) return checkScript(file, text, 0)
  return []
}

function collectFiles(root, filesFrom) {
  if (filesFrom) {
    const list = fs
      .readFileSync(filesFrom, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    return list.map((rel) => ({
      rel: rel.split(path.sep).join('/'),
      abs: path.isAbsolute(rel) ? rel : path.join(root, rel),
    }))
  }
  const patterns = [
    'src/**/*.{js,jsx,mjs,cjs,ts,tsx,vue,json}',
    '*.json',
  ]
  listSidecarDirs(root).forEach((name) => {
    patterns.push(name + '/**/*.{js,jsx,mjs,cjs,ts,tsx,vue,json}')
  })
  const absList = fg.sync(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: IGNORE,
  })
  return absList
    .filter((abs) => !abs.endsWith('.d.ts'))
    .map((abs) => ({
      abs,
      rel: path.relative(root, abs).split(path.sep).join('/'),
    }))
}

function checkProject(root, options) {
  const opts = options || {}
  const base = path.resolve(root)
  const files = collectFiles(base, opts.filesFrom || null)
  const issues = []
  files.forEach((f) => {
    if (!fs.existsSync(f.abs) || !fs.statSync(f.abs).isFile()) {
      issues.push({
        file: f.rel,
        line: 1,
        column: 1,
        kind: 'syntax',
        message: 'File not found',
      })
      return
    }
    let text = ''
    try {
      text = fs.readFileSync(f.abs, 'utf8')
    } catch (e) {
      issues.push({
        file: f.rel,
        line: 1,
        column: 1,
        kind: 'syntax',
        message: e.message,
      })
      return
    }
    checkText(f.rel, text).forEach((item) => issues.push(item))
  })
  return {
    ok: issues.length === 0,
    projectRoot: base,
    total: issues.length,
    issues,
    checkedAt: new Date().toISOString(),
    checker: __filename,
  }
}

function selfTest() {
  const assert = require('assert')
  const okJs = checkText('src/ok.js', 'const n = 1\nexport default n\n')
  assert.strictEqual(okJs.length, 0, 'valid js')

  const badBind = checkText('src/bad.js', 'const = 1\n')
  assert.ok(badBind.length === 1, 'broken const reported')
  assert.strictEqual(badBind[0].kind, 'binding', 'kind binding, got ' + badBind[0].kind + ' ' + badBind[0].message)

  const dup = checkText('src/a.js', 'const a = 1\nconst a = 2\n')
  assert.ok(dup.length === 1, 'duplicate lexical')
  assert.strictEqual(dup[0].kind, 'binding')

  const badJson = checkText('src/x.json', '{ "a": 1, }\n')
  assert.strictEqual(badJson[0].kind, 'json')

  const dupKey = checkText('src/d.json', '{\n  "a": 1,\n  "a": 2\n}\n')
  assert.strictEqual(dupKey.length, 1)
  assert.strictEqual(dupKey[0].kind, 'json-duplicate-key')
  assert.strictEqual(dupKey[0].line, 3)

  const jsonc = checkText('tsconfig.json', '{\n  // comment\n  "compilerOptions": { "strict": true, }\n}\n')
  assert.strictEqual(jsonc.length, 0, 'tsconfig comments allowed')

  const vue = checkText(
    'src/A.vue',
    '<template><div/></template>\n<script>\nconst =\n</script>\n'
  )
  assert.ok(vue.length === 1, 'vue script')
  assert.strictEqual(vue[0].kind, 'binding')
  assert.strictEqual(vue[0].line, 3)

  const vueOk = checkText(
    'src/B.vue',
    '<template><p>{{ n }}</p></template>\n<script>\nexport default { data() { return { n: 1 } } }\n</script>\n'
  )
  assert.strictEqual(vueOk.length, 0, 'valid vue')

  console.log('syntax-check self-test passed')
}

function printHelp() {
  console.log(`Usage: node scripts/check-syntax.js <projectRoot> [--json] [--files-from list] [--all]
       node scripts/check-syntax.js --self-test

Checks JSON, duplicate JSON keys, and JS/TS/Vue script syntax (binding errors included).
`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.indexOf('--self-test') !== -1) {
    selfTest()
    return
  }
  if (argv.indexOf('-h') !== -1 || argv.indexOf('--help') !== -1 || !argv[0] || argv[0].startsWith('-')) {
    printHelp()
    process.exit(argv.indexOf('-h') !== -1 || argv.indexOf('--help') !== -1 ? 0 : 1)
  }
  let filesFrom = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--files-from') filesFrom = argv[i + 1]
  }
  const report = checkProject(argv[0], { filesFrom })
  if (argv.indexOf('--json') !== -1) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    console.log(report.ok ? 'syntax check passed' : 'syntax check failed: ' + report.total)
    report.issues.slice(0, 40).forEach((item, i) => {
      console.log(
        i + 1 + '. ' + item.file + ':' + item.line + ' [' + item.kind + '] ' + item.message
      )
    })
  }
  process.exit(report.ok ? 0 : 1)
}

module.exports = {
  checkText,
  checkProject,
  duplicateJsonKeys,
  bindingKind,
}

if (require.main === module) main()

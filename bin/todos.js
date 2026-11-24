#!/usr/bin/env node
/**
 * 扫描迁移底座中的 AI-TODO 注释，输出「路径 + 行号」清单供 AI 逐项处理。
 *
 *   node bin/todos.js <底座根> [--json] [--out <file>]
 */
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { detectProjectRoot } = require('../src/detect-root')
const { TAG } = require('../src/pipeline/risk/annotate')
const { ensureProjectWorkDir, projectWorkDir } = require('../src/paths')
const { toPosixRel: toRel } = require('../src/resolve')

function printHelp() {
  console.log(`Usage: v23-todos <projectRoot> [options]

扫描「${TAG}」注释，输出路径与行号，方便 AI 直接跳转处理。

Options:
  --json           输出 JSON
  --out <file>     写入文件（默认 <project>/.v23/ai-todos.json|md）
  --stdout-only    不写文件，只打印
  -h, --help
`)
}

function parseArgs(argv) {
  const args = { root: null, json: false, out: null, stdoutOnly: false }
  const rest = argv.slice(2)
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--json') args.json = true
    else if (a === '--stdout-only') args.stdoutOnly = true
    else if (a === '--out') args.out = rest[++i]
    else if (!a.startsWith('-') && !args.root) args.root = a
  }
  return args
}

function parseTodoLine(line) {
  // /* 迁移脚本注释: AI-TODO [category] message */
  // <!-- 迁移脚本注释: AI-TODO [category] message -->
  const m = line.match(/AI-TODO\s*(?:\[([^\]]+)\])?\s*(.*?)?\s*(?:\*\/|-->)?\s*$/)
  if (!m) {
    return { category: null, message: line.trim() }
  }
  return {
    category: m[1] || null,
    message: (m[2] || '').replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').trim(),
  }
}

function scanTodos(projectRoot) {
  const root = path.resolve(projectRoot)
  const files = fg.sync(['src/**/*.{vue,js,jsx,ts,tsx,mjs,cjs}'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.v23/**'],
  })

  const items = []
  files.forEach((abs) => {
    const text = fs.readFileSync(abs, 'utf8')
    if (text.indexOf(TAG) === -1 && text.indexOf('AI-TODO') === -1) return
    const lines = text.split(/\r?\n/)
    const rel = toRel(abs, root)
    lines.forEach((line, i) => {
      if (line.indexOf(TAG) === -1 && !(line.indexOf('AI-TODO') !== -1 && line.indexOf('迁移脚本注释') !== -1)) {
        return
      }
      if (line.indexOf('AI-TODO') === -1) return
      const parsed = parseTodoLine(line)
      items.push({
        file: rel,
        line: i + 1,
        category: parsed.category,
        message: parsed.message,
        raw: line.trim(),
      })
    })
  })

  items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return { projectRoot: root, tag: TAG, total: items.length, todos: items }
}

function toMarkdown(doc) {
  const lines = []
  lines.push('# AI-TODO 清单')
  lines.push('')
  lines.push('- 项目: `' + doc.projectRoot + '`')
  lines.push('- 标记: `' + doc.tag + '`')
  lines.push('- 共 ' + doc.total + ' 条')
  lines.push('')
  lines.push('| # | 文件 | 行 | 类别 | 说明 |')
  lines.push('|---|------|----|------|------|')
  doc.todos.forEach((t, i) => {
    const msg = String(t.message || '').replace(/\|/g, '\\|')
    lines.push(
      '| ' +
        (i + 1) +
        ' | `' +
        t.file +
        '` | ' +
        t.line +
        ' | ' +
        (t.category || '-') +
        ' | ' +
        msg +
        ' |'
    )
  })
  lines.push('')
  lines.push('## 给 AI 的跳转列表')
  lines.push('')
  doc.todos.forEach((t, i) => {
    lines.push((i + 1) + '. `' + t.file + ':' + t.line + '` — [' + (t.category || '?') + '] ' + (t.message || ''))
  })
  lines.push('')
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.root) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  let root = path.resolve(args.root)
  if (!fs.existsSync(root)) {
    console.error('目录不存在:', root)
    process.exit(1)
  }
  const detected = detectProjectRoot(root)
  if (detected) root = detected

  const doc = scanTodos(root)

  // 控制台：紧凑路径:行号
  console.log('AI-TODO 共 ' + doc.total + ' 条 @ ' + root)
  doc.todos.forEach((t, i) => {
    console.log(
      (i + 1) + '. ' + t.file + ':' + t.line + '  [' + (t.category || '?') + '] ' + (t.message || '')
    )
  })

  if (!args.stdoutOnly) {
    ensureProjectWorkDir(root)
    const outJson = args.out
      ? path.resolve(args.out)
      : path.join(projectWorkDir(root), args.json ? 'ai-todos.json' : 'ai-todos.md')
    if (args.json || (args.out && String(args.out).endsWith('.json'))) {
      const target = args.out ? path.resolve(args.out) : path.join(projectWorkDir(root), 'ai-todos.json')
      fs.writeFileSync(target, JSON.stringify(doc, null, 2), 'utf8')
      console.log('写入', target)
    } else {
      const mdPath = args.out ? path.resolve(args.out) : path.join(projectWorkDir(root), 'ai-todos.md')
      fs.writeFileSync(mdPath, toMarkdown(doc), 'utf8')
      const jsonPath = path.join(projectWorkDir(root), 'ai-todos.json')
      fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2), 'utf8')
      console.log('写入', mdPath)
      console.log('写入', jsonPath)
    }
  }
}

main()

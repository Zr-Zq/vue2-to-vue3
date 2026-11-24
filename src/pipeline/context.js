const path = require('path')

/**
 * 单文件在流水线中的上下文（上一阶段输出 = 下一阶段输入）
 */
function createFileContext(input) {
  const file = {
    path: input.path, // project-relative posix
    absPath: input.absPath,
    content: input.content == null ? '' : String(input.content),
    originalContent: input.content == null ? '' : String(input.content),
    ext: path.extname(input.path || '').toLowerCase(),
    kind: input.kind || guessKind(input.path),
    ast: input.ast || null,
    meta: Object.assign({}, input.meta || {}),
    reports: [],
    changedBy: [],
    skippedBy: [],
    aborted: false,
    abortReason: null,
  }

  return {
    file,
    project: input.project,
    /** 插件写回内容；自动记变更来源 */
    setContent(next, pluginName) {
      const text = next == null ? '' : String(next)
      if (text !== file.content) {
        file.content = text
        file.ast = null // 内容变了，旧 AST 失效
        if (pluginName && !file.changedBy.includes(pluginName)) {
          file.changedBy.push(pluginName)
        }
      }
    },
    setAst(ast, pluginName) {
      file.ast = ast
      if (pluginName && !file.changedBy.includes(pluginName)) {
        file.changedBy.push(pluginName)
      }
    },
    report(entry) {
      file.reports.push(
        Object.assign(
          {
            level: 'info',
            plugin: null,
            message: '',
            loc: null,
          },
          entry
        )
      )
    },
    skip(pluginName, reason) {
      file.skippedBy.push({ plugin: pluginName, reason: reason || '' })
    },
    abort(reason) {
      file.aborted = true
      file.abortReason = reason || 'aborted'
    },
    get changed() {
      return file.content !== file.originalContent
    },
  }
}

function guessKind(relPath) {
  const ext = path.extname(relPath || '').toLowerCase()
  if (ext === '.vue') return 'vue'
  if (ext === '.ts' || ext === '.tsx') return 'ts'
  if (ext === '.scss') return 'scss'
  if (ext === '.sass') return 'sass'
  if (ext === '.less') return 'less'
  if (ext === '.css') return 'css'
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'js'
  return 'other'
}

function createProjectContext(opts) {
  return {
    root: opts.root,
    outDir: opts.outDir || null,
    dryRun: !!opts.dryRun,
    config: opts.config || {},
    graph: opts.graph || null,
    shared: Object.create(null), // 插件间共享（如预分析结果）
    stats: {
      files: 0,
      changed: 0,
      skipped: 0,
      errors: 0,
      byPlugin: Object.create(null),
    },
  }
}

module.exports = {
  createFileContext,
  createProjectContext,
  guessKind,
}

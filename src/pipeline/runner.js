const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { createFileContext, createProjectContext } = require('./context')
const { toPosixRel } = require('../resolve')

/**
 * 主流水线：文件依次过每个启用插件，上一阶段输出作为下一阶段输入。
 */
async function runPipeline(options) {
  const opts = options || {}
  const registry = opts.registry
  const config = opts.config
  const root = path.resolve(opts.root || config.__root)
  const fromDir = config.__loadedFrom ? path.dirname(config.__loadedFrom) : root

  // 前置风险流水线 + 迁移流水线（顺序可配、可热插拔）
  const preflightEntries = Array.isArray(config.preflightPipeline) ? config.preflightPipeline : []
  const transformEntries = Array.isArray(config.pipeline) ? config.pipeline : []
  const stages = registry.resolvePipeline(preflightEntries.concat(transformEntries), fromDir)
  // 合并全局 pluginOptions
  stages.forEach((s) => {
    const globalOpt = (config.pluginOptions && config.pluginOptions[s.name]) || {}
    s.options = Object.assign({}, s.options, globalOpt)
  })

  const project = createProjectContext({
    root,
    outDir: opts.outDir != null ? opts.outDir : config.outDir,
    dryRun: opts.dryRun != null ? opts.dryRun : config.dryRun,
    config,
    graph: opts.graph || null,
  })

  const api = createApi(project, stages)

  // setup
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i]
    await stage.plugin.setup(project, Object.assign({}, api, { options: stage.options, stage }))
  }

  const absFiles = fg.sync(config.include, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: config.exclude,
  })

  const results = []

  for (let fi = 0; fi < absFiles.length; fi += 1) {
    const abs = absFiles[fi]
    const rel = toPosixRel(abs, root)
    let content = fs.readFileSync(abs, 'utf8')

    const fileCtx = createFileContext({
      path: rel,
      absPath: abs,
      content,
      project,
    })

    project.stats.files += 1

    for (let si = 0; si < stages.length; si += 1) {
      if (fileCtx.file.aborted) break
      const stage = stages[si]
      const pluginApi = Object.assign({}, api, {
        options: stage.options,
        stage,
        pluginName: stage.name,
      })

      let matched = true
      try {
        matched = !!stage.plugin.match(fileCtx, pluginApi)
      } catch (e) {
        fileCtx.report({
          level: 'error',
          plugin: stage.name,
          message: 'match 失败: ' + e.message,
        })
        project.stats.errors += 1
        continue
      }

      if (!matched) {
        fileCtx.skip(stage.name, 'not-matched')
        continue
      }

      const before = fileCtx.file.content
      try {
        await stage.plugin.transform(fileCtx, pluginApi)
      } catch (e) {
        fileCtx.report({
          level: 'error',
          plugin: stage.name,
          message: 'transform 失败: ' + e.message,
        })
        project.stats.errors += 1
        bumpPlugin(project, stage.name, 'errors')
        continue
      }

      if (fileCtx.file.content !== before) {
        if (!fileCtx.file.changedBy.includes(stage.name)) {
          fileCtx.file.changedBy.push(stage.name)
        }
        bumpPlugin(project, stage.name, 'changed')
      }
      bumpPlugin(project, stage.name, 'ran')
    }

    if (fileCtx.changed) project.stats.changed += 1

    // 写出
    if (!project.dryRun && fileCtx.changed && !fileCtx.file.aborted) {
      const outPath = resolveOutPath(project, fileCtx.file)
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, fileCtx.file.content, 'utf8')
    }

    results.push({
      path: fileCtx.file.path,
      changed: fileCtx.changed,
      changedBy: fileCtx.file.changedBy.slice(),
      skippedBy: fileCtx.file.skippedBy.slice(),
      reports: fileCtx.file.reports.slice(),
      aborted: fileCtx.file.aborted,
      content: project.dryRun && !opts.keepContent ? undefined : fileCtx.file.content,
      originalContent:
        opts.keepContent || (!project.dryRun && fileCtx.changed)
          ? undefined
          : undefined,
    })
  }

  // teardown
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const stage = stages[i]
    await stage.plugin.teardown(project, Object.assign({}, api, { options: stage.options, stage }))
  }

  return {
    project,
    stages: stages.map((s) => ({ name: s.name, options: s.options })),
    results,
    stats: project.stats,
  }
}

function createApi(project, stages) {
  return {
    project,
    stages: stages.map((s) => s.name),
    log(msg) {
      if (project.config && project.config.verbose) {
        console.log('[pipeline]', msg)
      }
    },
    /** 查前置图：全局 / mixin */
    lookup(name) {
      if (!project.graph) return null
      try {
        const { lookupSymbol } = require('../analyze-mixins')
        return lookupSymbol(project.graph, name)
      } catch (e) {
        return null
      }
    },
    getFileFromGraph(rel) {
      if (!project.graph || !project.graph.files) return null
      return project.graph.files.find((f) => f.path === rel) || null
    },
  }
}

function bumpPlugin(project, name, key) {
  if (!project.stats.byPlugin[name]) {
    project.stats.byPlugin[name] = { ran: 0, changed: 0, errors: 0 }
  }
  project.stats.byPlugin[name][key] = (project.stats.byPlugin[name][key] || 0) + 1
}

function resolveOutPath(project, file) {
  if (!project.outDir) return file.absPath
  return path.join(project.outDir, file.path)
}

module.exports = {
  runPipeline,
}

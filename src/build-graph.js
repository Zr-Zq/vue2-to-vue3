const path = require('path')
const fg = require('fast-glob')
const { loadProjectConfig } = require('./config')
const fs = require('fs')
const { parseProjectFile } = require('./parse-file')
const { toPosixRel } = require('./resolve')
const { analyzeImportsExports } = require('./analyze-imports')
const { analyzeScopes, flattenScopes } = require('./analyze-scopes')
const { analyzeGlobals, indexGlobals } = require('./analyze-globals')
const { analyzeMixinApplications, buildMixinIndex } = require('./analyze-mixins')
const { analyzeVueHtml } = require('./analyze-html')

/**
 * 数据结构（图 + 每文件作用域树 + 全局登记）：
 * {
 *   meta, files[], edges[], dynamics[], globals[], globalIndex[],
 *   cycles[], entryTrees[], stats
 * }
 *
 * files[i] = {
 *   id, path, kind, scripts[], imports[], exports[],
 *   importers[], importees[], scopeTree, scopeFlat[], globals[], errors[]
 * }
 */
function buildGraph(projectRoot, options) {
  const opts = options || {}
  const config = loadProjectConfig(projectRoot)
  if (opts.include) config.include = opts.include
  if (opts.exclude) config.exclude = opts.exclude

  const absFiles = fg.sync(config.include, {
    cwd: config.root,
    absolute: true,
    onlyFiles: true,
    ignore: config.exclude,
    dot: false,
  })

  const files = new Map() // rel -> file node
  const fileRelSet = new Set(absFiles.map((abs) => toPosixRel(abs, config.root)))
  const edges = []
  const allDynamics = []
  const allGlobals = []
  const parseErrors = []

  absFiles.forEach((abs) => {
    const rel = toPosixRel(abs, config.root)
    const parsed = parseProjectFile(abs)
    const fileNode = {
      id: rel,
      path: rel,
      absPath: abs,
      kind: parsed.kind,
      scripts: [],
      imports: [],
      exports: [],
      dynamics: [],
      importers: [],
      importees: [],
      scopeTree: null,
      scopeFlat: [],
      globals: [],
      mixinApps: [],
      errors: parsed.errors.slice(),
      _asts: [],
    }

    if (parsed.template) {
      fileNode.template = {
        kind: 'html',
        lang: parsed.template.lang || 'html',
        lines: String(parsed.template.code || '').split(/\r?\n/).length,
      }
      try {
        const html = analyzeVueHtml(
          parsed.raw != null ? parsed.raw : fs.readFileSync(abs, 'utf8'),
          abs,
          rel
        )
        fileNode.html = {
          kind: 'html',
          summary: html.summary,
          findingCount: (html.findings || []).length,
          findings: (html.findings || []).map((f) => ({
            id: f.id,
            category: f.category,
            level: f.level,
            message: f.message,
            loc: f.loc,
            evidence: f.evidence,
          })),
        }
      } catch (e) {
        fileNode.html = { kind: 'html', error: String(e && e.message ? e.message : e) }
      }
    }
    if (parsed.skippedScripts && parsed.skippedScripts.length) {
      fileNode.skippedScripts = parsed.skippedScripts.map((s) => ({
        id: s.id,
        reason: s.skipReason || 'not-code',
        lang: s.lang,
      }))
    }

    parsed.scripts.forEach((script) => {
      // 非真代码 script：只登记，不走 JS 分析
      if (script.isRealCode === false || !script.ast) {
        fileNode.scripts.push({
          id: script.id,
          lang: script.lang,
          setup: script.setup,
          kind: 'js',
          isRealCode: false,
          skipReason: script.skipReason || (script.ast ? null : 'no-ast'),
          importCount: 0,
          exportCount: 0,
          bindingCount: 0,
          globalCount: 0,
        })
        return
      }

      const meta = { fileRel: rel, scriptId: script.id }
      const ie = analyzeImportsExports(script.ast, abs, config)
      const scopeTree = analyzeScopes(script.ast)
      const scopeFlat = flattenScopes(scopeTree, rel)
      const globals = analyzeGlobals(script.ast, meta)
      fileNode._asts.push(script.ast)

      fileNode.scripts.push({
        id: script.id,
        lang: script.lang,
        setup: script.setup,
        kind: 'js',
        isRealCode: true,
        skipReason: null,
        importCount: ie.imports.length,
        exportCount: ie.exports.length,
        bindingCount: scopeFlat.length,
        globalCount: globals.length,
      })

      ie.imports.forEach((imp) => {
        const toRel = imp.resolved ? toPosixRel(imp.resolved, config.root) : null
        // 解析到项目内但非分析范围（如 .scss）时标为 asset，不进依赖图节点
        const inGraph = !!(toRel && fileRelSet.has(toRel))
        const edge = {
          from: rel,
          to: toRel,
          source: imp.source,
          type: imp.type,
          external: !!imp.external || (!!toRel && !inGraph),
          externalKind: imp.external
            ? imp.externalKind || null
            : toRel && !inGraph
              ? 'asset'
              : imp.externalKind || null,
          specifiers: imp.specifiers,
          sideEffect: !!imp.sideEffect,
          scriptId: script.id,
          loc: imp.loc,
        }
        fileNode.imports.push(edge)
        if (!edge.external && edge.to) {
          edges.push({
            from: edge.from,
            to: edge.to,
            type: edge.type,
            scriptId: script.id,
            loc: edge.loc,
          })
        }
      })

      ie.exports.forEach((ex) => {
        fileNode.exports.push(Object.assign({ scriptId: script.id }, ex))
      })

      ie.dynamics.forEach((d) => {
        const dyn = Object.assign({ file: rel, scriptId: script.id }, d)
        if (d.resolved) dyn.to = toPosixRel(d.resolved, config.root)
        fileNode.dynamics.push(dyn)
        allDynamics.push(dyn)
        if (dyn.to) {
          edges.push({
            from: rel,
            to: dyn.to,
            type: 'dynamic:' + d.type,
            scriptId: script.id,
            loc: d.loc,
            dynamic: true,
          })
        }
      })

      // 多 script：合并 scope（vue SFC 可能有两个）
      if (!fileNode.scopeTree) {
        fileNode.scopeTree = scopeTree
      } else {
        fileNode.scopeTree = {
          id: 'module',
          type: 'module',
          name: '<module+scripts>',
          loc: null,
          bindings: [],
          children: [
            Object.assign({}, fileNode.scopeTree, { name: 'script' }),
            Object.assign({}, scopeTree, { name: script.id }),
          ],
        }
      }
      fileNode.scopeFlat = fileNode.scopeFlat.concat(scopeFlat)
      fileNode.globals = fileNode.globals.concat(globals)
      allGlobals.push(...globals)

      // mixin 应用（此时 imports 边已写入 fileNode.imports）
      const mixinApps = analyzeMixinApplications(script.ast, meta, fileNode.imports)
      fileNode.mixinApps = fileNode.mixinApps.concat(mixinApps)
    })

    if (parsed.errors.length) {
      parseErrors.push({ file: rel, errors: parsed.errors })
    }

    files.set(rel, fileNode)
  })

  // 填充 importers / importees
  edges.forEach((e) => {
    const from = files.get(e.from)
    const to = files.get(e.to)
    if (from && e.to && !from.importees.includes(e.to)) from.importees.push(e.to)
    if (to && e.from && !to.importers.includes(e.from)) to.importers.push(e.from)
  })

  // mixin 汇总 + 成员反查索引（需要各文件 AST）
  const allMixinApps = []
  files.forEach((f) => {
    allMixinApps.push(...(f.mixinApps || []))
  })
  const mixinIndex = buildMixinIndex(allMixinApps, files)

  // 环检测（Tarjan SCC，只报 size>1 或自环）
  const cycles = findCycles(Array.from(files.keys()), edges)

  // 入口树：main.js / main.ts 等
  const entryCandidates = ['src/main.js', 'src/main.ts', 'src/main.mjs', 'src/App.vue']
  const entryTrees = []
  entryCandidates.forEach((entry) => {
    if (files.has(entry)) {
      entryTrees.push({
        entry,
        tree: buildImportTree(entry, files, new Set(), 0, 12),
      })
    }
  })

  const fileList = Array.from(files.values()).map((f) => {
    const copy = Object.assign({}, f)
    delete copy._asts
    return copy
  })

  const stats = {
    fileCount: fileList.length,
    edgeCount: edges.length,
    dynamicCount: allDynamics.length,
    globalRegistrationCount: allGlobals.length,
    mixinApplicationCount: allMixinApps.length,
    mixinMemberCount: mixinIndex.memberIndex.length,
    cycleCount: cycles.length,
    parseErrorCount: parseErrors.length,
    orphanCount: fileList.filter((f) => f.importers.length === 0 && !/main\.(js|ts)$/.test(f.path)).length,
    externalImportCount: fileList.reduce(
      (n, f) => n + f.imports.filter((i) => i.external).length,
      0
    ),
  }

  return {
    meta: {
      projectRoot: config.root,
      packageName: config.packageName,
      analyzedAt: new Date().toISOString(),
      alias: Object.keys(config.alias).reduce((acc, k) => {
        acc[k] = toPosixRel(config.alias[k], config.root) || config.alias[k]
        return acc
      }, {}),
    },
    stats,
    files: fileList,
    edges,
    dynamics: allDynamics,
    globals: allGlobals,
    globalIndex: indexGlobals(allGlobals),
    mixins: mixinIndex,
    cycles,
    entryTrees,
    parseErrors,
  }
}

function findCycles(nodes, edges) {
  const adj = new Map()
  nodes.forEach((n) => adj.set(n, []))
  edges.forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, [])
    if (e.to && adj.has(e.to)) adj.get(e.from).push(e.to)
  })

  let index = 0
  const indices = new Map()
  const lowlink = new Map()
  const onStack = new Set()
  const stack = []
  const sccs = []

  function strongconnect(v) {
    indices.set(v, index)
    lowlink.set(v, index)
    index += 1
    stack.push(v)
    onStack.add(v)

    ;(adj.get(v) || []).forEach((w) => {
      if (!indices.has(w)) {
        strongconnect(w)
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)))
      }
    })

    if (lowlink.get(v) === indices.get(v)) {
      const comp = []
      let w
      do {
        w = stack.pop()
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      if (comp.length > 1) sccs.push(comp)
      else if (comp.length === 1 && (adj.get(comp[0]) || []).includes(comp[0])) {
        sccs.push(comp)
      }
    }
  }

  nodes.forEach((v) => {
    if (!indices.has(v)) strongconnect(v)
  })
  return sccs
}

function buildImportTree(fileId, files, visiting, depth, maxDepth) {
  const node = files.get(fileId)
  if (!node) return { id: fileId, missing: true, children: [] }
  if (depth >= maxDepth) return { id: fileId, truncated: true, children: [] }
  if (visiting.has(fileId)) return { id: fileId, cycle: true, children: [] }

  visiting.add(fileId)
  const children = node.importees.slice(0, 40).map((childId) =>
    buildImportTree(childId, files, new Set(visiting), depth + 1, maxDepth)
  )
  visiting.delete(fileId)

  return {
    id: fileId,
    kind: node.kind,
    importCount: node.imports.length,
    globalCount: node.globals.length,
    bindingCount: node.scopeFlat.length,
    children,
  }
}

module.exports = {
  buildGraph,
}

const path = require('path')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { parseProjectFile, parseProjectSource } = require('../../parse-file')
const { decomposeVue } = require('../../sfc-parts')
const { analyzeVueHtml, analyzeHtmlTemplate } = require('../../analyze-html')

function ensureRiskStore(project) {
  if (!project.shared.risks) {
    project.shared.risks = []
  }
  if (!project.shared.riskIndex) {
    project.shared.riskIndex = Object.create(null)
  }
  return project.shared.risks
}

/**
 * @param {object} project
 * @param {{
 *   id: string,
 *   category: string,
 *   level: 'info'|'warn'|'block',
 *   auto: 'yes'|'partial'|'no',
 *   file: string,
 *   message: string,
 *   loc?: object|null,
 *   evidence?: string,
 *   hint?: string,
 * }} finding
 */
function pushRisk(project, finding) {
  const list = ensureRiskStore(project)
  const item = Object.assign(
    {
      loc: null,
      evidence: '',
      hint: '',
      auto: 'partial',
      level: 'warn',
    },
    finding
  )
  const dedupeKey = [
    item.file,
    item.id,
    item.loc && item.loc.line,
    item.evidence,
  ].join('|')
  if (!project.shared._riskDedupe) project.shared._riskDedupe = new Set()
  if (project.shared._riskDedupe.has(dedupeKey)) return
  project.shared._riskDedupe.add(dedupeKey)

  list.push(item)
  const key = item.category
  project.shared.riskIndex[key] = (project.shared.riskIndex[key] || 0) + 1
}

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return { line: node.loc.start.line, column: node.loc.start.column }
}

/**
 * 加载应走 JS 处理的 script（真代码 + 有 AST）。
 * Vue：只用 jsParts；普通 js：整文件。
 * 优先用流水线里当前 content，避免读到磁盘旧内容。
 */
function loadScripts(fileCtx) {
  try {
    const abs = fileCtx.file.absPath || fileCtx.file.path || 'anon'
    const content = fileCtx.file.content
    const parsed =
      content != null
        ? parseProjectSource(content, abs)
        : abs && fileCtx.file.absPath
          ? parseProjectFile(fileCtx.file.absPath)
          : null
    if (!parsed) return []
    return (parsed.jsParts || parsed.scripts || []).filter((s) => s.isRealCode !== false && s.ast)
  } catch (e) {
    return []
  }
}

/** 加载 Vue template（html 部分） */
function loadHtmlParts(fileCtx) {
  try {
    const abs = fileCtx.file.absPath || 'anon.vue'
    const content = fileCtx.file.content
    if (fileCtx.file.ext !== '.vue' && fileCtx.file.kind !== 'vue') return []
    const parts = decomposeVue(content != null ? content : '', abs)
    return parts.htmlParts || []
  } catch (e) {
    return []
  }
}

/**
 * 分析当前文件 HTML（template）部分；带缓存到 file.meta
 */
function loadHtmlAnalysis(fileCtx) {
  try {
    if (fileCtx.file.ext !== '.vue' && fileCtx.file.kind !== 'vue') return null
    if (fileCtx.file.meta && fileCtx.file.meta.htmlAnalysis) {
      return fileCtx.file.meta.htmlAnalysis
    }
    const abs = fileCtx.file.absPath || 'anon.vue'
    const analysis = analyzeVueHtml(fileCtx.file.content, abs, fileCtx.file.path)
    if (!fileCtx.file.meta) fileCtx.file.meta = {}
    fileCtx.file.meta.htmlAnalysis = analysis
    return analysis
  } catch (e) {
    return null
  }
}

/** 把 html findings 推入风险表 */
function pushHtmlFindings(project, analysis, filePath) {
  if (!analysis || !analysis.findings) return 0
  let n = 0
  analysis.findings.forEach((f) => {
    pushRisk(project, {
      id: f.id,
      category: f.category,
      level: f.level || 'warn',
      auto: f.auto || 'partial',
      file: f.file || filePath,
      message: f.message,
      loc: f.loc,
      evidence: f.evidence || '',
      hint: f.hint || '',
      part: 'html',
    })
    n += 1
  })
  return n
}

function memberName(node) {
  if (!t.isMemberExpression(node)) return null
  if (t.isThisExpression(node.object) && t.isIdentifier(node.property) && !node.computed) {
    return node.property.name
  }
  return null
}

function thisMemberChain(node) {
  // this.a.b → ['a','b'] ；仅支持非 computed
  const parts = []
  let cur = node
  while (t.isMemberExpression(cur)) {
    if (cur.computed || !t.isIdentifier(cur.property)) return null
    parts.unshift(cur.property.name)
    cur = cur.object
  }
  if (!t.isThisExpression(cur)) return null
  return parts
}

/** 从 Options API 抽 props 名集合 */
function collectPropNames(ast) {
  const names = new Set()
  if (!ast) return names
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration
      let obj = null
      if (t.isObjectExpression(d)) obj = d
      else if (t.isIdentifier(d)) {
        const b = p.scope.getBinding(d.name)
        if (b && b.path.isVariableDeclarator() && t.isObjectExpression(b.path.node.init)) {
          obj = b.path.node.init
        }
      }
      if (!obj) return
      obj.properties.forEach((prop) => {
        if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
        const key = t.isIdentifier(prop.key)
          ? prop.key.name
          : t.isStringLiteral(prop.key)
            ? prop.key.value
            : null
        if (key !== 'props') return
        const val = t.isObjectMethod(prop) ? null : prop.value
        if (t.isArrayExpression(val)) {
          val.elements.forEach((el) => {
            if (t.isStringLiteral(el)) names.add(el.value)
          })
        } else if (t.isObjectExpression(val)) {
          val.properties.forEach((pp) => {
            if (!t.isObjectProperty(pp) && !t.isObjectMethod(pp)) return
            const n = t.isIdentifier(pp.key)
              ? pp.key.name
              : t.isStringLiteral(pp.key)
                ? pp.key.value
                : null
            if (n) names.add(n)
          })
        }
      })
    },
  })
  return names
}

function hasOptionKey(ast, optionName) {
  let hit = false
  if (!ast) return false
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const d = p.node.declaration
      let obj = null
      if (t.isObjectExpression(d)) obj = d
      else if (t.isCallExpression(d) && t.isIdentifier(d.callee, { name: 'defineComponent' }) && t.isObjectExpression(d.arguments[0])) {
        obj = d.arguments[0]
      }
      if (!obj) return
      obj.properties.forEach((prop) => {
        if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return
        const key = t.isIdentifier(prop.key)
          ? prop.key.name
          : t.isStringLiteral(prop.key)
            ? prop.key.value
            : null
        if (key === optionName) hit = true
      })
    },
  })
  return hit
}

function extractTemplate(content, absPath) {
  // 走 SFC 拆解的 html 部分（避免正则截断嵌套 template）
  try {
    const parts = decomposeVue(String(content || ''), absPath || 'anon.vue')
    if (parts.template && parts.template.code) return parts.template.code
  } catch (e) {
    /* fallthrough */
  }
  return ''
}

function summarizeRisks(project) {
  const risks = project.shared.risks || []
  const byCategory = Object.create(null)
  const byAuto = { yes: 0, partial: 0, no: 0 }
  const byLevel = { info: 0, warn: 0, block: 0 }
  risks.forEach((r) => {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1
    byAuto[r.auto] = (byAuto[r.auto] || 0) + 1
    byLevel[r.level] = (byLevel[r.level] || 0) + 1
  })
  return {
    total: risks.length,
    byCategory,
    byAuto,
    byLevel,
  }
}

module.exports = {
  ensureRiskStore,
  pushRisk,
  locOf,
  loadScripts,
  loadHtmlParts,
  loadHtmlAnalysis,
  pushHtmlFindings,
  memberName,
  thisMemberChain,
  collectPropNames,
  hasOptionKey,
  extractTemplate,
  analyzeVueHtml,
  analyzeHtmlTemplate,
  summarizeRisks,
  traverse,
  t,
  path,
}

const { decomposeVue, partKindAtOffset } = require('../../sfc-parts')

/** Marker written into source for AI follow-up (legacy Chinese prefix still recognized). */
const TAG = 'AI-TODO'
const LEGACY_TAG = '迁移脚本注释: AI-TODO'

function commentFor(risk, style) {
  const cat = risk.category || 'risk'
  const msg = String(risk.message || risk.id || '')
    .replace(/\*\//g, '* /')
    .replace(/-->/g, '-- >')
  const body = `${TAG}: [${cat}] ${msg}`
  if (style === 'html') return `<!-- ${body} -->`
  return `/* ${body} */`
}

function lineHasTodoMarker(line) {
  if (!line) return false
  return line.indexOf(TAG) !== -1 || line.indexOf(LEGACY_TAG) !== -1
}

function alreadyAnnotated(line, risk) {
  if (!lineHasTodoMarker(line)) return false
  if (risk.category && line.indexOf('[' + risk.category + ']') !== -1) return true
  return lineHasTodoMarker(line)
}

/**
 * Line offset of a content slice inside a .vue file
 * (0-based: first line of the block to file line = offset).
 */
function scriptLineOffset(fileContent, scriptContent) {
  if (!scriptContent) return 0
  const idx = fileContent.indexOf(scriptContent)
  if (idx === -1) return 0
  return fileContent.slice(0, idx).split(/\r?\n/).length - 1
}

function findLineByEvidence(lines, evidence) {
  if (!evidence) return -1
  const needle = String(evidence).slice(0, 80)
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].indexOf(needle) !== -1) return i
  }
  const parts = needle.split(/[\s/'"`]+/).filter((p) => p.length > 3)
  for (let p = 0; p < parts.length; p += 1) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].indexOf(parts[p]) !== -1) return i
    }
  }
  return -1
}

function offsetOfLine(lines, lineIdx) {
  let off = 0
  for (let i = 0; i < lineIdx && i < lines.length; i += 1) {
    off += lines[i].length + 1
  }
  return off
}

const TEMPLATE_CATEGORIES = new Set([
  'v-for-v-if',
  'filters',
  'legacy-slot',
  'dynamic-args',
  'native-modifier',
  'keepalive-combo',
])

/**
 * Insert AI-TODO comments into content:
 * - Vue template (html) to <!-- -->
 * - Vue script / plain js to /* *\/
 * @param {string} content
 * @param {object[]} risks
 * @param {{ kind?: string, scriptContents?: string[], absPath?: string }} meta
 */
function annotateContent(content, risks, meta) {
  if (!risks || !risks.length) return { content, inserted: 0 }
  const lines = content.split(/\r?\n/)
  const insertAt = new Map()

  const isVue = meta.kind === 'vue'
  const decomposed = isVue ? decomposeVue(content, meta.absPath || 'anon.vue') : null

  const scriptOffsets = (meta.scriptContents || [])
    .map((sc) => scriptLineOffset(content, sc))
    .filter((n) => n >= 0)

  // Line offsets of real script blocks (for babel loc)
  if (decomposed && decomposed.jsParts) {
    decomposed.jsParts.forEach((p) => {
      if (p.range && p.range.startLine) {
        const off = p.range.startLine - 1
        if (!scriptOffsets.includes(off)) scriptOffsets.push(off)
      }
    })
  }

  risks.forEach((risk) => {
    let lineIdx = -1
    const inTemplateCat = TEMPLATE_CATEGORIES.has(risk.category)

    if (risk.loc && risk.loc.line) {
      // babel loc is relative to script: add first real-script offset
      const offset = isVue && scriptOffsets.length ? scriptOffsets[0] : 0
      lineIdx = offset + risk.loc.line - 1
    }
    if (lineIdx < 0 || lineIdx >= lines.length) {
      lineIdx = findLineByEvidence(lines, risk.evidence || risk.message)
    }
    if (lineIdx < 0) {
      lineIdx = 0
      if (isVue) {
        // Template risks to template; script risks to first real script
        if (inTemplateCat && decomposed && decomposed.template && decomposed.template.range) {
          lineIdx = decomposed.template.range.startLine - 1
        } else if (decomposed && decomposed.jsParts && decomposed.jsParts[0] && decomposed.jsParts[0].range) {
          lineIdx = decomposed.jsParts[0].range.startLine - 1
        } else {
          const ti = lines.findIndex((l) => /<script\b/i.test(l))
          if (ti >= 0) lineIdx = ti + 1
        }
      }
    }

    // Comment style: html vs js based on insertion point
    let useStyle = 'js'
    if (isVue && decomposed) {
      if (inTemplateCat) useStyle = 'html'
      else {
        const off = offsetOfLine(lines, lineIdx)
        const kind = partKindAtOffset(decomposed, off)
        useStyle = kind === 'html' ? 'html' : 'js'
      }
    }

    const cmt = commentFor(risk, useStyle === 'html' ? 'html' : 'js')
    if (alreadyAnnotated(lines[lineIdx], risk)) return
    if (lineIdx > 0 && alreadyAnnotated(lines[lineIdx - 1], risk)) return

    if (!insertAt.has(lineIdx)) insertAt.set(lineIdx, [])
    const list = insertAt.get(lineIdx)
    if (!list.some((x) => x === cmt)) list.push(cmt)
  })

  if (!insertAt.size) return { content, inserted: 0 }

  const indices = Array.from(insertAt.keys()).sort((a, b) => b - a)
  let inserted = 0
  indices.forEach((idx) => {
    const comments = insertAt.get(idx)
    const indent = lines[idx] && lines[idx].match(/^\s*/) ? lines[idx].match(/^\s*/)[0] : ''
    const block = comments.map((c) => indent + c)
    lines.splice(idx, 0, ...block)
    inserted += block.length
  })

  return { content: lines.join('\n'), inserted }
}

module.exports = {
  TAG,
  LEGACY_TAG,
  commentFor,
  annotateContent,
  scriptLineOffset,
}

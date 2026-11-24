/**
 * 把 .vue SFC 拆成可分别处理的部分：
 * - template → html
 * - script / scriptSetup → js（仅「真代码」才进入 JS 处理）
 * - style → style（本模块只暴露，默认不走 js/html）
 */
const compilerSfc = require('@vue/compiler-sfc')

const JS_LANGS = new Set(['', 'js', 'jsx', 'ts', 'tsx', 'javascript', 'typescript'])

/** 明确不是可执行 JS 的 script type */
const NON_JS_SCRIPT_TYPE = /^(text\/(x-)?template|text\/html|application\/json|text\/json|text\/css|text\/plain)(\s|;|$)/i

/**
 * @param {string} content
 * @param {string} [filename]
 */
function parseVueDescriptor(content, filename) {
  const code = String(content || '')
  const file = filename || 'anon.vue'
  if (typeof compilerSfc.parseComponent === 'function') {
    return compilerSfc.parseComponent(code, { filename: file })
  }
  const parsed = compilerSfc.parse(code, { filename: file })
  return parsed.descriptor || parsed
}

function attrOf(block, name) {
  if (!block) return null
  // SFCDescriptor 上 type/content 是块元数据，不是 HTML 属性；HTML attrs 只看 attrs
  const attrs = block.attrs || block.attrsMap || null
  if (attrs) {
    if (attrs[name] != null) return attrs[name]
    const lower = String(name).toLowerCase()
    const key = Object.keys(attrs).find((k) => String(k).toLowerCase() === lower)
    if (key != null) return attrs[key]
  }
  // lang / src 在 descriptor 上常有顶层字段
  if (name === 'lang' && block.lang != null) return block.lang
  if (name === 'src' && block.src != null) return block.src
  return null
}

/**
 * 去掉注释与空白后，是否还像可执行 JS（避免空块、纯注释、src 外链空壳）
 */
function stripJsNoise(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '')
}

/**
 * 判断 SFC 的 script 块是否应走 JS 处理
 * @returns {{ ok: boolean, reason: string|null }}
 */
function isRealJsScript(block) {
  if (!block) return { ok: false, reason: 'empty-block' }

  const lang = String(block.lang != null ? block.lang : attrOf(block, 'lang') || '')
    .trim()
    .toLowerCase()
  if (!JS_LANGS.has(lang)) {
    return { ok: false, reason: 'lang:' + (lang || '?') }
  }

  const typeRaw = String(attrOf(block, 'type') || '').trim()
  if (typeRaw) {
    const type = typeRaw.toLowerCase()
    if (NON_JS_SCRIPT_TYPE.test(type)) {
      return { ok: false, reason: 'type:' + typeRaw }
    }
    // module / text/javascript / typescript 等放行；其它未知 type 不当真 JS
    const okType =
      type === 'module' ||
      /^(text|application)\/(java|ecma)script/.test(type) ||
      type === 'text/typescript' ||
      type === 'text/tsx' ||
      type === 'text/jsx'
    if (!okType) return { ok: false, reason: 'type:' + typeRaw }
  }

  const src = block.src || attrOf(block, 'src')
  const code = block.content == null ? '' : String(block.content)
  if (src && !code.trim()) {
    return { ok: false, reason: 'src-only' }
  }

  const noiseFree = stripJsNoise(code)
  if (!noiseFree) {
    return { ok: false, reason: 'not-code' }
  }
  // 至少要有标识符类字符，排除纯标点
  if (!/[A-Za-z_$]/.test(noiseFree)) {
    return { ok: false, reason: 'not-code' }
  }

  return { ok: true, reason: null }
}

function blockRangeInFile(fileContent, blockContent) {
  if (!blockContent) return null
  const idx = String(fileContent).indexOf(blockContent)
  if (idx === -1) return null
  const before = fileContent.slice(0, idx)
  const startLine = before.split(/\r?\n/).length // 1-based
  const lineCount = String(blockContent).split(/\r?\n/).length
  return {
    startOffset: idx,
    endOffset: idx + blockContent.length,
    startLine,
    endLine: startLine + lineCount - 1,
  }
}

/**
 * 优先用 SFC 块的 start/end（源码真实切片）；compiler 的 content 可能被去缩进，不能直接字符串替换回文件。
 */
function blockSpanFromDescriptor(raw, block) {
  if (!block) return null
  if (typeof block.start === 'number' && typeof block.end === 'number' && block.end >= block.start) {
    const rawCode = String(raw).slice(block.start, block.end)
    const before = String(raw).slice(0, block.start)
    const startLine = before.split(/\r?\n/).length
    const lineCount = rawCode.split(/\r?\n/).length
    return {
      startOffset: block.start,
      endOffset: block.end,
      startLine,
      endLine: startLine + lineCount - 1,
      rawCode,
    }
  }
  const fallback = blockRangeInFile(raw, block.content)
  if (!fallback) return null
  return Object.assign({}, fallback, { rawCode: String(block.content || '') })
}

/**
 * 拆解 Vue 文件为 html / js 等部分
 * @returns {{
 *   kind: 'vue',
 *   descriptor: object,
 *   template: object|null,
 *   scripts: object[],
 *   styles: object[],
 *   htmlParts: object[],
 *   jsParts: object[],
 *   skippedScripts: object[],
 *   errors: string[],
 * }}
 */
function decomposeVue(content, absPath) {
  const raw = String(content || '')
  const errors = []
  let descriptor
  try {
    descriptor = parseVueDescriptor(raw, absPath || 'anon.vue')
  } catch (e) {
    return {
      kind: 'vue',
      descriptor: null,
      template: null,
      scripts: [],
      styles: [],
      htmlParts: [],
      jsParts: [],
      skippedScripts: [],
      errors: ['sfc parse: ' + (e && e.message ? e.message : e)],
    }
  }

  const sfcErrors = descriptor.errors || []
  if (sfcErrors && sfcErrors.length) {
    sfcErrors.forEach((e) => errors.push(String(e.message || e)))
  }

  const templateSpan =
    descriptor.template != null ? blockSpanFromDescriptor(raw, descriptor.template) : null
  const template =
    descriptor.template && (descriptor.template.content != null || templateSpan)
      ? {
          id: 'template',
          kind: 'html',
          // 写回用 rawCode；分析也优先 raw，避免缩进归一化导致替换失败
          code: templateSpan ? templateSpan.rawCode : String(descriptor.template.content || ''),
          normalizedCode: descriptor.template.content == null ? null : String(descriptor.template.content),
          lang: String(descriptor.template.lang || 'html').toLowerCase(),
          range: templateSpan,
          attrs: descriptor.template.attrs || null,
        }
      : null

  const scriptBlocks = []
  if (descriptor.script) {
    scriptBlocks.push({ id: 'script', setup: false, block: descriptor.script })
  }
  if (descriptor.scriptSetup) {
    scriptBlocks.push({ id: 'scriptSetup', setup: true, block: descriptor.scriptSetup })
  }

  const scripts = []
  const jsParts = []
  const skippedScripts = []

  scriptBlocks.forEach(({ id, setup, block }) => {
    const check = isRealJsScript(block)
    const lang = String(block.lang || attrOf(block, 'lang') || 'js').toLowerCase() || 'js'
    const span = blockSpanFromDescriptor(raw, block)
    const entry = {
      id,
      kind: 'js',
      code: span ? span.rawCode : block.content == null ? '' : String(block.content),
      normalizedCode: block.content == null ? null : String(block.content),
      lang,
      setup,
      src: block.src || attrOf(block, 'src') || null,
      attrs: block.attrs || null,
      isRealCode: check.ok,
      skipReason: check.reason,
      range: span,
      rawBlock: block,
    }
    scripts.push(entry)
    if (check.ok) jsParts.push(entry)
    else skippedScripts.push(entry)
  })

  const styles = (descriptor.styles || []).map((st, i) => {
    const span = blockSpanFromDescriptor(raw, st)
    return {
      id: 'style' + i,
      kind: 'style',
      code: span ? span.rawCode : st.content == null ? '' : String(st.content),
      lang: String(st.lang || 'css').toLowerCase(),
      scoped: !!st.scoped,
      module: st.module || null,
      range: span,
    }
  })

  const htmlParts = template ? [template] : []

  return {
    kind: 'vue',
    descriptor,
    template,
    scripts,
    styles,
    htmlParts,
    jsParts,
    skippedScripts,
    errors,
  }
}

/**
 * 按字符偏移判断落在 html(template) 还是 js(script)
 * @returns {'html'|'js'|'other'}
 */
function partKindAtOffset(decomposed, offset) {
  if (!decomposed || offset == null || offset < 0) return 'other'
  const tpl = decomposed.template && decomposed.template.range
  if (tpl && offset >= tpl.startOffset && offset < tpl.endOffset) return 'html'
  for (let i = 0; i < (decomposed.jsParts || []).length; i += 1) {
    const r = decomposed.jsParts[i].range
    if (r && offset >= r.startOffset && offset < r.endOffset) return 'js'
  }
  for (let i = 0; i < (decomposed.scripts || []).length; i += 1) {
    const r = decomposed.scripts[i].range
    if (r && offset >= r.startOffset && offset < r.endOffset) return 'js'
  }
  return 'other'
}

module.exports = {
  parseVueDescriptor,
  isRealJsScript,
  stripJsNoise,
  decomposeVue,
  blockRangeInFile,
  blockSpanFromDescriptor,
  partKindAtOffset,
  JS_LANGS,
}

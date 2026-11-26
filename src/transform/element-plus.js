/**
 * Deterministic Element UI → Element Plus rewrites (regex / string).
 *
 * Covered (script-safe):
 * - size medium→default, mini→small (attrs + JS object literals)
 * - el-button type="text" → boolean `text`
 * - el-link :underline true/false → underline="always|never"
 * - date format / value-format tokens (yyyy→YYYY, dd→DD, WW→ww, timestamp→x)
 * - package / path imports element-ui → element-plus
 * - dialog/drawer custom-class → class
 * - el-dialog / el-drawer visibility: :visible.sync / v-model:visible → v-model
 * - theme CSS path hints (prebuilt index.css only)
 * - el-submenu → el-sub-menu
 * - static icon="el-icon-*" / prefix-icon / suffix-icon → PascalCase (register @element-plus/icons-vue)
 * - static <i class="el-icon-*"></i> → <el-icon><Pascal /></el-icon>
 * - CSS chrome on .el-input__inner → .el-input__wrapper (+ neutralize inner border/bg)
 *
 * Not auto (AI-TODO once per file):
 * - dynamic :icon="'el-icon-*'" / leftover el-icon-* class strings
 * - Vue.use(ElementUI) → createApp().use(ElementPlus)
 * - SCSS theme-chalk variable pipelines ($--color-* / packages/theme-chalk)
 * - Locale.use → ElConfigProvider :locale / app.use({ locale })
 */

const AI_ICON =
  'AI-TODO: [element] remaining el-icon-* — register @element-plus/icons-vue globally and finish dynamic :icon bindings'

/** el-icon-arrow-right / el-icon-s-platform → ArrowRight / Platform */
function elIconClassToPascal(raw) {
  let name = String(raw || '')
  if (!/^el-icon-/.test(name)) return null
  name = name.replace(/^el-icon-/, '')
  // Element UI "solid" prefix
  if (name.indexOf('s-') === 0) name = name.slice(2)
  const aliases = {
    'star-off': 'Star',
    date: 'Calendar',
    time: 'Clock',
    'circle-check': 'CircleCheck',
    'circle-close': 'CircleClose',
    'remove-outline': 'Remove',
    'zoom-in': 'ZoomIn',
    'zoom-out': 'ZoomOut',
  }
  if (aliases[name]) return aliases[name]
  return name
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

function rewriteIconAttrs(code, changes) {
  let out = code
  // icon="el-icon-search" | prefix-icon | suffix-icon
  out = out.replace(
    /\b(icon|prefix-icon|suffix-icon)\s*=\s*(["'])el-icon-([^"']+)\2/g,
    (m, attr, q, rest) => {
      const pascal = elIconClassToPascal('el-icon-' + rest)
      if (!pascal) return m
      pushChange(changes, 'icon-attr', attr + ':' + rest + '→' + pascal)
      return attr + '=' + q + pascal + q
    }
  )
  // <i class="el-icon-search"></i> / <i class="el-icon-arrow-right el-icon--right"></i>
  out = out.replace(/<i\b([^>]*)>\s*<\/i>/g, (m, attrs) => {
    const cm = /\bclass\s*=\s*(["'])([^"']*)\1/.exec(attrs)
    if (!cm) return m
    const q = cm[1]
    const parts = String(cm[2])
      .split(/\s+/)
      .filter(Boolean)
    const iconPart = parts.find((p) => /^el-icon-/.test(p) && p.indexOf('el-icon--') !== 0)
    if (!iconPart) return m
    const pascal = elIconClassToPascal(iconPart)
    if (!pascal) return m
    const restClass = parts
      .filter((p) => p !== iconPart && (!/^el-icon-/.test(p) || /^el-icon--/.test(p)))
      .join(' ')
    pushChange(changes, 'icon-i-tag', iconPart + '→' + pascal)
    const classAttr = restClass ? ' class=' + q + restClass + q : ''
    return '<el-icon' + classAttr + '><' + pascal + ' /></el-icon>'
  })
  return out
}
const AI_USE =
  'AI-TODO: [element] move Vue.use(ElementPlus) to createApp(App).use(ElementPlus, options)'
const AI_THEME =
  'AI-TODO: [element] theme-chalk SCSS variables — rebuild with Element Plus theme or CSS vars'
const AI_LOCALE =
  'AI-TODO: [element] Locale.use → el-config-provider :locale / app.use(ElementPlus, { locale })'

function pushChange(changes, kind, detail) {
  changes.push({ kind: kind, detail: detail || '' })
}

function rewriteSizeToken(value) {
  if (value === 'medium') return 'default'
  if (value === 'mini') return 'small'
  return value
}

/** size="medium"|mini and :size="'medium'" / :size='"mini"' forms. */
function rewriteSizeLiterals(code, changes) {
  let out = code
  out = out.replace(/\bsize\s*=\s*(["'])(medium|mini)\1/g, (m, q, val) => {
    const next = rewriteSizeToken(val)
    if (next !== val) pushChange(changes, 'size-attr', val + '→' + next)
    return 'size=' + q + next + q
  })
  // Nested-quote binds first, then plain :size="…" / :size='…'
  ;[
    [/:size\s*=\s*"'(medium|mini)'"/g, (v) => ':size="\'' + v + '\'"'],
    [/:size\s*=\s*'"(medium|mini)"'/g, (v) => ':size=\'"' + v + '"\''],
    [/:size\s*=\s*"(medium|mini)"/g, (v) => ':size="' + v + '"'],
    [/:size\s*=\s*'(medium|mini)'/g, (v) => ":size='" + v + "'"],
  ].forEach(([re, build]) => {
    out = out.replace(re, (m, val) => {
      const next = rewriteSizeToken(val)
      if (next !== val) pushChange(changes, 'size-bind', val + '→' + next)
      return build(next)
    })
  })
  out = out.replace(/\bsize\s*:\s*(["'])(medium|mini)\1/g, (m, q, val) => {
    const next = rewriteSizeToken(val)
    if (next !== val) pushChange(changes, 'size-js', val + '→' + next)
    return 'size: ' + q + next + q
  })
  return out
}

function rewriteDateFormatValue(val) {
  let next = String(val)
  if (next === 'timestamp') return 'x'
  next = next.replace(/yyyy/g, 'YYYY')
  next = next.replace(/dd/g, 'DD')
  next = next.replace(/WW/g, 'ww')
  return next
}

/** format / value-format attribute string literals (template + some JS). */
function rewriteDateFormatAttrs(code, changes) {
  return code.replace(
    /(^|[\s\n])(:?(?:value-)?format)\s*=\s*(["'])([^"']*)\3/g,
    (m, lead, attr, q, val) => {
      const next = rewriteDateFormatValue(val)
      if (next !== val) pushChange(changes, 'date-format', val + '→' + next)
      return lead + attr + '=' + q + next + q
    }
  )
}

/** JS object keys format: 'yyyy-MM-dd' / "yyyy-MM-dd". */
function rewriteDateFormatJsStrings(code, changes) {
  return code.replace(
    /\b((?:valueF|f)ormat)\s*:\s*(["'])([^"']*)\2/g,
    (m, key, q, val) => {
      const next = rewriteDateFormatValue(val)
      if (next !== val) pushChange(changes, 'date-format-js', val + '→' + next)
      return key + ': ' + q + next + q
    }
  )
}

const BUTTON_TYPE_TEXT_RE = /\s*:?type\s*=\s*(?:"text"|'text'|"'text'"|'"text"')/

/**
 * el-button type="text" → text (boolean). Keeps other type= primary/… .
 * Also :type="'text'" / :type='"text"'.
 */
function rewriteButtonTextType(code, changes) {
  return code.replace(/<el-button\b([^>]*?)(\/?)>/gi, (full, attrs, selfClose) => {
    let a = attrs
    if (!BUTTON_TYPE_TEXT_RE.test(a)) return full
    a = a.replace(/\s*:?type\s*=\s*(?:"text"|'text'|"'text'"|'"text'")/g, '')
    if (!/(^|\s)text(\s|=|$|\/)/.test(a)) {
      a = ' text' + a
    }
    pushChange(changes, 'button-text', 'type=text→text')
    return '<el-button' + a + selfClose + '>'
  })
}

/**
 * el-link :underline="false|true" → underline="never|always"
 * Bare underline without value stays (Plus treats boolean poorly — normalize if :underline).
 */
function rewriteLinkUnderline(code, changes) {
  return code.replace(/<el-link\b([^>]*?)(\/?)>/gi, (full, attrs, selfClose) => {
    let a = attrs
    let hit = false
    a = a.replace(/\s*:underline\s*=\s*(['"])false\1/g, () => {
      hit = true
      return ' underline="never"'
    })
    a = a.replace(/\s*:underline\s*=\s*(['"])true\1/g, () => {
      hit = true
      return ' underline="always"'
    })
    a = a.replace(/\s*:underline\s*=\s*\{\s*false\s*\}/g, () => {
      hit = true
      return ' underline="never"'
    })
    a = a.replace(/\s*:underline\s*=\s*\{\s*true\s*\}/g, () => {
      hit = true
      return ' underline="always"'
    })
    // boolean false without binding: underline="false" (invalid in Plus)
    a = a.replace(/\s*underline\s*=\s*(['"])false\1/g, () => {
      hit = true
      return ' underline="never"'
    })
    a = a.replace(/\s*underline\s*=\s*(['"])true\1/g, () => {
      hit = true
      return ' underline="always"'
    })
    if (hit) pushChange(changes, 'link-underline', 'underline enum')
    return '<el-link' + a + selfClose + '>'
  })
}

/** el-dialog / el-drawer custom-class → class */
function rewriteCustomClass(code, changes) {
  return code.replace(
    /<(el-dialog|el-drawer|el-message-box)\b([^>]*?)(\/?)>/gi,
    (full, tag, attrs, selfClose) => {
      if (!/\bcustom-class\s*=/.test(attrs)) return full
      const next = attrs.replace(/\bcustom-class\s*=/g, 'class=')
      pushChange(changes, 'custom-class', tag)
      return '<' + tag + next + selfClose + '>'
    }
  )
}

/**
 * Element Plus dialog/drawer use v-model for visibility (not :visible.sync / v-model:visible).
 * Runs after migrate-html may have turned :visible.sync into v-model:visible.
 */
function rewriteDialogVisible(code, changes) {
  return code.replace(
    /<(el-dialog|el-drawer)\b([^>]*?)(\/?)>/gi,
    (full, tag, attrs, selfClose) => {
      let next = attrs
      let hit = false
      // :visible.sync="x" / v-bind:visible.sync="x"
      next = next.replace(
        /\s*(?::|v-bind:)visible\.sync\s*=\s*(["'])([\s\S]*?)\1/gi,
        (_, q, expr) => {
          hit = true
          return ' v-model=' + q + expr + q
        }
      )
      // v-model:visible="x" (from html .sync rewrite or hand-written)
      next = next.replace(/\s*v-model:visible\s*=\s*(["'])([\s\S]*?)\1/gi, (_, q, expr) => {
        hit = true
        return ' v-model=' + q + expr + q
      })
      if (!hit) return full
      pushChange(changes, 'dialog-visible-v-model', tag)
      return '<' + tag + next + selfClose + '>'
    }
  )
}

function rewriteImports(code, changes) {
  let out = code
  // Mask SCSS theme source paths so the generic element-ui/ → element-plus/
  // rewrite does not invent element-plus/packages/theme-chalk (does not exist).
  const THEME_SRC_MASK = '__V23_EU_THEME_SRC__'
  if (/element-ui\/packages\/theme-chalk\//.test(out)) {
    out = out.replace(/element-ui\/packages\/theme-chalk\//g, THEME_SRC_MASK)
    pushChange(changes, 'theme-scss-keep', 'packages/theme-chalk')
  }
  const replacers = [
    // bare package
    [/from\s+(['"])element-ui\1/g, "from $1element-plus$1", 'import-package'],
    [/require\s*\(\s*(['"])element-ui\1\s*\)/g, 'require($1element-plus$1)', 'require-package'],
    // deep paths — locale lang packs only (root Locale.use is AI-owned)
    [
      /(['"])element-ui\/lib\/locale\/lang\/zh-CN\1/g,
      "$1element-plus/es/locale/lang/zh-cn$1",
      'locale-zh',
    ],
    [
      /(['"])element-ui\/lib\/locale\/lang\/en\1/g,
      "$1element-plus/es/locale/lang/en$1",
      'locale-en',
    ],
    // theme css
    [
      /(['"])element-ui\/lib\/theme-chalk\/index\.css\1/g,
      "$1element-plus/dist/index.css$1",
      'theme-css',
    ],
    [
      /(['"])~element-ui\/lib\/theme-chalk\/index\.css\1/g,
      "$1element-plus/dist/index.css$1",
      'theme-css-tilde',
    ],
    // generic element-ui/ → element-plus/ (after specific rules)
    [/(['"])element-ui\//g, '$1element-plus/', 'path-prefix'],
    [/(['"])~element-ui\//g, '$1element-plus/', 'path-prefix-tilde'],
  ]
  replacers.forEach(([re, replacement, kind]) => {
    const before = out
    out = out.replace(re, replacement)
    if (out !== before) pushChange(changes, kind, '')
  })
  if (out.indexOf(THEME_SRC_MASK) !== -1) {
    out = out.replace(new RegExp(THEME_SRC_MASK, 'g'), 'element-ui/packages/theme-chalk/')
  }
  return out
}

/** el-submenu → el-sub-menu (Element Plus rename). */
function rewriteSubmenu(code, changes) {
  let out = code
  const before = out
  out = out.replace(/<\/?el-submenu\b/g, (m) => {
    pushChange(changes, 'el-sub-menu', m)
    return m.replace('el-submenu', 'el-sub-menu')
  })
  if (out === before) return out
  return out
}

function rewriteElementUiIdent(code, changes) {
  let out = code
  // import ElementUI from 'element-plus' (after package rewrite) → ElementPlus
  out = out.replace(
    /\bimport\s+ElementUI\s+from\s+(['"])element-plus\1/g,
    (m, q) => {
      pushChange(changes, 'ident-ElementPlus', '')
      return 'import ElementPlus from ' + q + 'element-plus' + q
    }
  )
  out = out.replace(
    /\bimport\s*\*\s*as\s+ElementUI\s+from\s+(['"])element-plus\1/g,
    (m, q) => {
      pushChange(changes, 'ident-ElementPlus-star', '')
      return 'import * as ElementPlus from ' + q + 'element-plus' + q
    }
  )
  // Keep call sites in sync with the renamed binding (createApp wiring still AI-TODO).
  out = out.replace(/\bVue\.use\s*\(\s*ElementUI\b/g, () => {
    pushChange(changes, 'use-ElementPlus', '')
    return 'Vue.use(ElementPlus'
  })
  return out
}

function ensureAiTodo(code, needleTest, comment, style) {
  if (!needleTest(code)) return code
  if (code.indexOf(comment) !== -1) return code
  if (style === 'html') {
    return '<!-- ' + comment + ' -->\n' + code
  }
  return '/* ' + comment + ' */\n' + code
}

function migrateElementTemplate(tpl) {
  const changes = []
  let code = String(tpl || '')
  const before = code
  code = rewriteButtonTextType(code, changes)
  code = rewriteLinkUnderline(code, changes)
  code = rewriteCustomClass(code, changes)
  code = rewriteDialogVisible(code, changes)
  code = rewriteSizeLiterals(code, changes)
  code = rewriteDateFormatAttrs(code, changes)
  code = rewriteSubmenu(code, changes)
  code = rewriteIconAttrs(code, changes)
  if (/el-icon-/.test(code)) {
    code = ensureAiTodo(code, () => true, AI_ICON, 'html')
    if (!changes.some((c) => c.kind === 'ai-icon')) {
      pushChange(changes, 'ai-icon', 'todo')
    }
  }
  return { code: code, changes: changes }
}

function migrateElementScript(js) {
  const changes = []
  let code = String(js || '')
  const hadLocaleRoot =
    /element-ui\/lib\/locale['"]/.test(code) || /\bLocale\.use\s*\(/.test(code)
  code = rewriteImports(code, changes)
  code = rewriteElementUiIdent(code, changes)
  code = rewriteSizeLiterals(code, changes)
  code = rewriteDateFormatAttrs(code, changes)
  code = rewriteDateFormatJsStrings(code, changes)
  if (/Vue\.use\s*\(\s*Element(UI|Plus)/.test(code) || /\bElementUI\b/.test(code)) {
    const prev = code
    code = ensureAiTodo(code, () => /Vue\.use\s*\(\s*Element/.test(code), AI_USE, 'js')
    if (code !== prev) pushChange(changes, 'ai-use', 'todo')
  }
  if (/theme-chalk\/src|\$--color-primary/.test(code)) {
    const prev = code
    code = ensureAiTodo(code, () => true, AI_THEME, 'js')
    if (code !== prev) pushChange(changes, 'ai-theme', 'todo')
  }
  if (hadLocaleRoot || /element-ui\/lib\/locale['"]/.test(code) || /\bLocale\.use\s*\(/.test(code)) {
    const prev = code
    code = ensureAiTodo(code, () => true, AI_LOCALE, 'js')
    if (code !== prev) pushChange(changes, 'ai-locale', 'todo')
  }
  return { code: code, changes: changes }
}

/**
 * Element Plus paints the input box on `.el-input__wrapper`.
 * Old Element UI overrides that set border/background/box-shadow on
 * `.el-input__inner` cause a double “ghost” box — move chrome selectors to
 * `__wrapper` and neutralize the native input.
 *
 * Leaves typography-only rules (color / text-align / font-*) on `__inner`.
 * Leaves `::placeholder` / webkit pseudos on `__inner`.
 * `.el-textarea__inner` stays (textarea has no wrapper).
 */
function rewriteInputChromeSelectors(css, changes) {
  let out = String(css || '')
  let did = false

  const masks = []
  out = out.replace(/\.el-input__inner:(:)?(placeholder|[a-z0-9-]*webkit[a-z0-9-]*)\b/gi, (m) => {
    const id = '__V23_INPUT_INNER_PSEUDO_' + masks.length + '__'
    masks.push(m)
    return id
  })

  const mark = (next) => {
    did = true
    return next
  }
  out = out.replace(/\.el-input__inner:focus\b/g, () => mark('.el-input__wrapper.is-focus'))
  out = out.replace(/\.el-input__inner:hover\b/g, () => mark('.el-input__wrapper:hover'))

  const CHROME_DECL =
    /\b(border(?:-color|-radius|-width|-style)?|background(?:-color)?|box-shadow)\s*:/
  // Innermost rules first so nested SCSS (`html.dark { .el-input__inner {…} }`) works.
  function rewriteLeafBlocks(src) {
    return src.replace(/((?:[^{}'"`]|'[^']*'|"[^"]*")+)\{([^{}]*)\}/g, (full, sel, decls) => {
      if (!/\.el-input__inner\b/.test(sel)) return full
      if (!CHROME_DECL.test(decls)) return full
      const nextSel = sel.replace(/\.el-input__inner\b/g, '.el-input__wrapper')
      if (nextSel === sel) return full
      did = true
      return nextSel + '{' + decls + '}'
    })
  }
  let prev
  do {
    prev = out
    out = rewriteLeafBlocks(out)
  } while (out !== prev)

  masks.forEach((m, i) => {
    out = out.split('__V23_INPUT_INNER_PSEUDO_' + i + '__').join(m)
  })

  if (did) {
    pushChange(changes, 'input-wrapper', '')
    if (!/\.el-input__inner\s*\{[^}]*\bborder\s*:\s*none\b/.test(out)) {
      out +=
        '\n/* v23: Element Plus — border/background live on .el-input__wrapper */\n' +
        '.el-input__inner {\n' +
        '  border: none !important;\n' +
        '  background: transparent !important;\n' +
        '  box-shadow: none !important;\n' +
        '}\n'
      pushChange(changes, 'input-inner-reset', '')
    }
  }
  return out
}

function migrateElementStyle(css) {
  const changes = []
  let code = String(css || '')
  const before = code
  code = rewriteImports(code, changes)
  code = rewriteInputChromeSelectors(code, changes)
  if (/element-ui|theme-chalk\/src|\$--color-primary/.test(before)) {
    code = ensureAiTodo(code, () => /theme-chalk\/src|\$--color-primary/.test(before), AI_THEME, 'js')
    if (code !== before && !changes.some((c) => c.kind === 'ai-theme')) {
      pushChange(changes, 'ai-theme', 'todo')
    }
  }
  return { code: code, changes: changes }
}

/**
 * Full-file migrate for .vue / .js / .css / .scss sources when SFC split is unavailable.
 */
function migrateElementSource(source, filePath) {
  const changes = []
  let code = String(source || '')
  const fp = String(filePath || '')
  const isVue = /\.vue$/i.test(fp) || /<template[\s>]/.test(code)
  if (isVue) {
    // Prefer caller using applySfcTransforms; fallback whole-file regex still helps JS/CSS-in-vue lightly
    const t = migrateElementTemplate(code)
    code = t.code
    changes.push(...t.changes)
    const s = migrateElementScript(code)
    code = s.code
    changes.push(...s.changes)
    return { code: code, changes: changes }
  }
  if (/\.(scss|sass|css|less)$/i.test(fp)) {
    return migrateElementStyle(code)
  }
  return migrateElementScript(code)
}

module.exports = {
  migrateElementTemplate,
  migrateElementScript,
  migrateElementStyle,
  migrateElementSource,
  rewriteSizeLiterals,
  rewriteDateFormatValue,
  rewriteButtonTextType,
  rewriteLinkUnderline,
  rewriteInputChromeSelectors,
  AI_ICON,
  AI_USE,
  AI_THEME,
}

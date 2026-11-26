/**
 * Element UI → Element Plus deterministic rewrites
 *   node test/element-plus.test.js
 */
const assert = require('assert')
const {
  migrateElementTemplate,
  migrateElementScript,
  migrateElementStyle,
  rewriteDateFormatValue,
} = require('../src/transform/element-plus')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== size medium/mini ==')
{
  const r = migrateElementTemplate(
    '<el-button size="medium">A</el-button><el-input size="mini" /><el-select :size="\'mini\'" />'
  )
  ok(/size="default"/.test(r.code), 'medium→default')
  ok(/size="small"/.test(r.code), 'mini→small')
  ok(/:size="'small'"/.test(r.code), ':size mini→small')
  ok(!/medium|mini/.test(r.code), 'no medium/mini left')
}

console.log('== button type=text → text ==')
{
  const r = migrateElementTemplate(
    [
      '<el-button type="text">文字</el-button>',
      '<el-button type=\'text\' disabled>禁用</el-button>',
      '<el-button type="primary">主色</el-button>',
      '<el-button :type="\'text\'" size="mini" />',
    ].join('\n')
  )
  ok(/<el-button text>/.test(r.code) || /<el-button text /.test(r.code), 'type=text→text')
  ok(/<el-button text disabled>/.test(r.code), 'text + disabled')
  ok(/type="primary"/.test(r.code), 'primary kept')
  ok(!/type=["']text["']/.test(r.code), 'no type=text left')
  ok(/size="small"/.test(r.code), 'mini size also rewritten on same tag')
}

console.log('== link underline ==')
{
  const r = migrateElementTemplate(
    '<el-link :underline="false">无</el-link><el-link :underline="true">有</el-link><el-link underline="false">x</el-link>'
  )
  ok(/underline="never"/.test(r.code), 'false→never')
  ok(/underline="always"/.test(r.code), 'true→always')
  ok(!/:underline=/.test(r.code), 'no :underline left')
}

console.log('== date format tokens ==')
{
  ok(rewriteDateFormatValue('yyyy-MM-dd') === 'YYYY-MM-DD', 'yyyy-MM-dd')
  ok(rewriteDateFormatValue('yyyy 第 WW 周') === 'YYYY 第 ww 周', 'week WW')
  ok(rewriteDateFormatValue('timestamp') === 'x', 'timestamp→x')
  const r = migrateElementTemplate(
    '<el-date-picker type="date" format="yyyy-MM-dd" value-format="yyyy-MM-dd HH:mm:ss" />'
  )
  ok(/format="YYYY-MM-DD"/.test(r.code), 'format attr')
  ok(/value-format="YYYY-MM-DD HH:mm:ss"/.test(r.code), 'value-format attr')
}

console.log('== custom-class ==')
{
  const r = migrateElementTemplate('<el-dialog custom-class="x" title="t"></el-dialog>')
  ok(/\bclass="x"/.test(r.code), 'custom-class→class')
  ok(!/custom-class/.test(r.code), 'no custom-class')
}

console.log('== dialog/drawer visible → v-model ==')
{
  const r = migrateElementTemplate(
    [
      '<el-dialog :visible.sync="open" title="t"></el-dialog>',
      '<el-drawer v-model:visible="side"></el-drawer>',
      '<el-dialog v-bind:visible.sync="nested" width="420px" />',
      '<Child :visible.sync="keep" />',
    ].join('\n')
  )
  ok(/<el-dialog v-model="open"/.test(r.code), ':visible.sync→v-model on dialog')
  ok(/<el-drawer v-model="side"/.test(r.code), 'v-model:visible→v-model on drawer')
  ok(/<el-dialog v-model="nested"/.test(r.code), 'v-bind:visible.sync→v-model')
  ok(/:visible\.sync="keep"/.test(r.code), 'non-el Child keeps :visible.sync for html stream')
  ok(!/el-dialog[^>]*visible\.sync/.test(r.code) && !/el-drawer[^>]*v-model:visible/.test(r.code), 'no dialog/drawer visible leftover')
}

console.log('== imports + ElementPlus ident ==')
{
  const r = migrateElementScript(
    [
      "import ElementUI from 'element-ui'",
      "import 'element-ui/lib/theme-chalk/index.css'",
      "import zhCN from 'element-ui/lib/locale/lang/zh-CN'",
      "Vue.use(ElementUI, { size: 'medium' })",
    ].join('\n')
  )
  ok(/from 'element-plus'/.test(r.code), 'package→element-plus')
  ok(/import ElementPlus from 'element-plus'/.test(r.code), 'ElementUI→ElementPlus')
  ok(/Vue\.use\(ElementPlus/.test(r.code), 'Vue.use(ElementPlus)')
  ok(
    !/Vue\.use\(ElementUI/.test(r.code.replace(/\/\*[\s\S]*?\*\//g, '')),
    'no Vue.use(ElementUI) in code'
  )
  ok(/element-plus\/dist\/index\.css/.test(r.code), 'theme css path')
  ok(/element-plus\/es\/locale\/lang\/zh-cn/.test(r.code), 'locale path')
  ok(/size: 'default'/.test(r.code), 'JS size medium→default')
  ok(/AI-TODO: \[element\] move Vue\.use\(ElementPlus\)/.test(r.code), 'AI-TODO for createApp')
}

console.log('== icon attr + i-tag rewrite ==')
{
  const r = migrateElementTemplate(
    '<el-button icon="el-icon-search">S</el-button><i class="el-icon-arrow-right el-icon--right"></i>'
  )
  ok(/icon="Search"/.test(r.code), 'icon attr → Search')
  ok(/<el-icon class="el-icon--right"><ArrowRight \/>/.test(r.code), 'i-tag → el-icon')
  ok(!/el-icon-search/.test(r.code), 'no el-icon-search left')
}

console.log('== style theme import ==')
{
  const r = migrateElementStyle("@import '~element-ui/lib/theme-chalk/index.css';")
  ok(/element-plus\/dist\/index\.css/.test(r.code), 'scss/css import rewritten')
}

console.log('== input chrome .el-input__inner → .el-input__wrapper ==')
{
  const src = [
    '.el-input__inner,',
    '.el-textarea__inner {',
    '  color: var(--app-text);',
    '  border-color: var(--app-border);',
    '  background-color: var(--surface);',
    '}',
    '.el-input__inner:hover { border-color: #ccc; }',
    '.el-input__inner:focus,',
    '.el-select .el-input.is-focus .el-input__inner {',
    '  border-color: var(--app-brand);',
    '  box-shadow: 0 0 0 3px var(--app-brand-soft);',
    '}',
    '.el-input-number .el-input__inner { text-align: center; }',
    '.el-input__inner::placeholder { color: #999; }',
  ].join('\n')
  const r = migrateElementStyle(src)
  ok(/\.el-input__wrapper,/.test(r.code) || /\.el-input__wrapper\s*,/.test(r.code), 'chrome selector → wrapper')
  ok(/\.el-textarea__inner/.test(r.code), 'textarea stays __inner')
  ok(/\.el-input__wrapper:hover/.test(r.code), 'hover → wrapper:hover')
  ok(/\.el-input__wrapper\.is-focus/.test(r.code), 'focus → wrapper.is-focus')
  ok(/\.el-select .*__wrapper/.test(r.code), 'select focus path → wrapper')
  ok(/\.el-input-number \.el-input__inner \{ text-align/.test(r.code), 'text-align stays on inner')
  ok(/\.el-input__inner::placeholder/.test(r.code), 'placeholder stays on inner')
  ok(/\.el-input__inner \{\s*border:\s*none !important/s.test(r.code), 'inner reset appended')
  ok(r.changes.some((c) => c.kind === 'input-wrapper'), 'input-wrapper change')
}

console.log('== keep packages/theme-chalk + Locale.use AI-TODO ==')
{
  const style = migrateElementStyle(
    "$--color-primary: #4f6ef7;\n@import 'element-ui/packages/theme-chalk/src/index';"
  )
  ok(
    /element-ui\/packages\/theme-chalk\/src\/index/.test(style.code),
    'does not invent element-plus/packages/theme-chalk'
  )
  ok(/AI-TODO: \[element\] theme-chalk/.test(style.code), 'theme SCSS AI-TODO')

  const script = migrateElementScript(
    [
      "import Locale from 'element-ui/lib/locale'",
      "import zhCN from 'element-ui/lib/locale/lang/zh-CN'",
      'Locale.use(zhCN)',
    ].join('\n')
  )
  ok(!/element-plus\/es\/locale['"]/.test(script.code), 'no broken locale root rewrite')
  ok(/element-plus\/es\/locale\/lang\/zh-cn/.test(script.code), 'lang pack still rewritten')
  ok(/AI-TODO: \[element\] Locale\.use/.test(script.code), 'Locale.use AI-TODO')
}

console.log('== el-submenu → el-sub-menu ==')
{
  const r = migrateElementTemplate('<el-submenu index="1"><el-menu-item index="1-1">A</el-menu-item></el-submenu>')
  ok(/<el-sub-menu\b/.test(r.code), 'opening tag')
  ok(/<\/el-sub-menu>/.test(r.code), 'closing tag')
  ok(!/el-submenu/.test(r.code), 'no el-submenu left')
}

console.log('== no false positive on primary button ==')
{
  const r = migrateElementTemplate('<el-button type="primary" size="small">OK</el-button>')
  ok(r.changes.length === 0, 'unchanged primary/small')
  ok(r.code === '<el-button type="primary" size="small">OK</el-button>', 'code identical')
}

console.log('\nAll element-plus tests passed.')

/**
 * functional → 普通组件 单测（覆盖官方文档常见写法）
 *   node test/functional.test.js
 */
const assert = require('assert')
const {
  stripTemplateFunctionalAttr,
  rewriteFunctionalTemplateBody,
  migrateFunctionalTemplate,
  migrateFunctionalScript,
} = require('../src/transform/functional')
const { applySfcTransforms } = require('../src/transform/apply-sfc')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

function migrateVue(src) {
  let content = String(src || '').replace(
    /^[ \t]*\/\*\s*迁移脚本注释:[\s\S]*?\*\/[ \t]*\r?\n/gm,
    (m) => (/\[functional\]/.test(m) ? '' : m)
  )
  const s = stripTemplateFunctionalAttr(content)
  let out = applySfcTransforms(
    s.code,
    'anon.vue',
    (tpl) => migrateFunctionalTemplate(tpl),
    (js) => migrateFunctionalScript(js, 'anon.vue')
  )
  content = out.content
  if (
    /v-on\s*=\s*["']listeners["']/.test(content) ||
    /\bfunctional\s*:\s*true\b/.test(content)
  ) {
    content = content.replace(/(<template\b[^>]*>)([\s\S]*?)(<\/template>)/i, (full, open, body, close) => {
      const r = migrateFunctionalTemplate(body)
      return r.changes.length ? open + r.code + close : full
    })
    content = content.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/i, (full, open, body, close) => {
      const r = migrateFunctionalScript(body, 'anon.vue#fb')
      return r.changes.length ? open + r.code + close : full
    })
    out = { content, changes: out.changes }
  }
  return out
}

console.log('== 官方 SFC 示例：props + attrs + listeners ==')
{
  // https://v3-migration.vuejs.org/breaking-changes/functional-components.html
  const src = [
    '<template functional>',
    '  <component',
    '    :is="`h${props.level}`"',
    '    v-bind="attrs"',
    '    v-on="listeners"',
    '  />',
    '</template>',
    '<script>',
    "export default { props: ['level'] }",
    '</script>',
  ].join('\n')
  const r = migrateVue(src)
  ok(/<template>/.test(r.content) || /<template\s*>/.test(r.content), 'strip functional attr')
  ok(!/<template[^>]*\bfunctional\b/i.test(r.content), 'no template functional')
  ok(/\$props\.level/.test(r.content), 'props → $props')
  ok(/v-bind="\$attrs"/.test(r.content), 'attrs → $attrs')
  ok(!/v-on="listeners"/.test(r.content), 'listeners dropped')
}

console.log('== LcFunctional 风格：data.attrs + data.staticClass ==')
{
  const src = [
    '<template functional>',
    '  <span :class="data.staticClass" v-bind="data.attrs" v-on="listeners">{{ props.text }}</span>',
    '</template>',
    '<script>',
    'export default { functional: true, props: { text: String } }',
    '</script>',
  ].join('\n')
  const r = migrateVue(src)
  ok(/\$props\.text/.test(r.content), '$props.text')
  ok(/v-bind="\$attrs"/.test(r.content), 'data.attrs → $attrs')
  ok(!/data\.staticClass/.test(r.content), 'staticClass dropped')
  ok(!/functional\s*:\s*true/.test(r.content), 'option removed')
  ok(!/v-on="listeners"/.test(r.content), 'no listeners')
}

console.log('== FunctionalTag：props + slot + listeners ==')
{
  const src = [
    '<template functional>',
    '  <span :class="[`is-${props.type}`]" v-on="listeners">',
    '    <slot>{{ props.text }}</slot>',
    '  </span>',
    '</template>',
    '<script>',
    'export default { name: "T", functional: true, props: { text: String, type: String } }',
    '</script>',
  ].join('\n')
  const r = migrateVue(src)
  ok(/\$props\.type/.test(r.content) && /\$props\.text/.test(r.content), 'both props')
  ok(/<slot>/.test(r.content), 'slot kept')
}

console.log('== props 下标 / slots ==')
{
  const body = rewriteFunctionalTemplateBody(
    "<div>{{ props['msg'] }} {{ slots.default }} {{ scopedSlots.x }}</div>"
  )
  ok(/\$props\['msg'\]/.test(body.code), 'props[]')
  ok(/\$slots\.default/.test(body.code), 'slots')
  ok(/\$slots\.x/.test(body.code), 'scopedSlots → $slots')
}

console.log('== JS render(h, ctx) functional ==')
{
  const src = [
    'export default {',
    '  functional: true,',
    "  props: ['level'],",
    '  render(h, { props, data, children }) {',
    '    return h("h" + props.level, data, children)',
    '  }',
    '}',
  ].join('\n')
  const r = migrateFunctionalScript(src, 'dyn.js')
  ok(!/functional\s*:\s*true/.test(r.code), 'option gone')
  ok(/this\.\$props/.test(r.code), 'ctx props → this.$props')
  ok(/render\s*\(\s*h\s*\)/.test(r.code) || /render\s*\(h\)/.test(r.code), 'single h param')
}

console.log('== 幂等 ==')
{
  const src = [
    '<template functional>',
    '  <p v-bind="data.attrs" v-on="listeners">{{ props.n }}</p>',
    '</template>',
    '<script>export default { functional: true, props: ["n"] }</script>',
  ].join('\n')
  const a = migrateVue(src).content
  const b = migrateVue(a).content
  assert.strictEqual(a, b, 'idempotent')
  ok(true, 'idempotent')
}

console.log('\nfunctional tests passed')

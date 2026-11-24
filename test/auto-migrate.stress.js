/**
 * 确定性 migrate 多轮压测：各种写法 + 幂等 + 合成样本
 *
 *   node test/auto-migrate.stress.js
 *   node test/auto-migrate.stress.js --rounds 20 --synth 200
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { migrateHtmlTemplate } = require('../src/transform/html-directives')
const { migrateApiCompat } = require('../src/transform/js-api-compat')
const { migrateDirectiveHooks } = require('../src/transform/js-directive-hooks')
const { migrateFiltersOption } = require('../src/transform/js-filters-option')
const { migrateCssDeep } = require('../src/transform/css-deep')
const { migrateExtend } = require('../src/transform/js-extend')
const { migrateMount } = require('../src/transform/js-mount')
const { migrateRenderH } = require('../src/transform/js-render-h')
const { applySfcTransforms } = require('../src/transform/apply-sfc')

function parseArgs(argv) {
  const args = { rounds: 12, synth: 120 }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--rounds') args.rounds = Math.max(1, Number(argv[++i]) || 12)
    else if (argv[i] === '--synth') args.synth = Math.max(0, Number(argv[++i]) || 120)
  }
  return args
}

function stripNoise(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, '""')
}

function assertCleanJs(code, label) {
  const c = stripNoise(code)
  assert.ok(!/\bbeforeDestroy\b/.test(c), label + ': beforeDestroy left')
  assert.ok(!/\bthis\.\$set\b/.test(c), label + ': $set left')
  assert.ok(!/\bthis\.\$delete\b/.test(c), label + ': $delete left')
  assert.ok(!/\bthis\.\$listeners\b/.test(c), label + ': $listeners left')
  assert.ok(!/\bthis\.\$scopedSlots\b/.test(c), label + ': $scopedSlots left')
  assert.ok(!/\bVue\.extend\s*\(/.test(c), label + ': Vue.extend left')
  assert.ok(!/\.\$mount\s*\(/.test(c), label + ': $mount left')
}

function assertCleanHtml(code, label) {
  const c = stripNoise(code)
  // 只认「指令形态」：:prop.sync= / @evt.native / v-on="$listeners"
  assert.ok(!/:[A-Za-z_][\w.-]*\.sync\s*=/.test(c), label + ': :prop.sync left')
  assert.ok(!/v-bind:[A-Za-z_][\w.-]*\.sync\s*=/.test(c), label + ': v-bind:.sync left')
  assert.ok(!/@[A-Za-z_][\w.-]*\.native\b/.test(c), label + ': @evt.native left')
  assert.ok(!/\sv-on\s*=\s*["']\$listeners["']/.test(c), label + ': v-on=$listeners left')
  assert.ok(
    !/<([A-Za-z][\w.-]*)(\s[^>]*\bv-for\s*=[^>]*\bv-if\s*=[^>]*>)/.test(c) &&
      !/<([A-Za-z][\w.-]*)(\s[^>]*\bv-if\s*=[^>]*\bv-for\s*=[^>]*>)/.test(c),
    label + ': same-node v-for+v-if left'
  )
}

function assertCleanCss(code, label) {
  // 只在 style 规则里查，避免文案里的 >>>
  const styles = String(code || '').match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [code]
  styles.forEach((block, i) => {
    const c = stripNoise(block)
    assert.ok(!/::v-deep/.test(c), label + ': ::v-deep left #' + i)
    assert.ok(!/\/deep\//.test(c), label + ': /deep/ left #' + i)
    assert.ok(!/>>>/.test(c), label + ': >>> left #' + i)
  })
}

function migrateVueFile(src, filename) {
  return applySfcTransforms(
    src,
    filename,
    (tpl) => migrateHtmlTemplate(tpl),
    (js) => {
      let code = js
      let changes = []
      ;[
        migrateRenderH,
        migrateApiCompat,
        migrateDirectiveHooks,
        migrateFiltersOption,
        migrateExtend,
        migrateMount,
      ].forEach((fn) => {
        const r = fn(code, filename)
        if (r.changes && r.changes.length) {
          code = r.code
          changes = changes.concat(r.changes)
        }
      })
      return { code, changes }
    },
    (css) => migrateCssDeep(css)
  )
}

function idempotent(migrateFn, src, times, label) {
  let cur = src
  let first = null
  for (let i = 0; i < times; i += 1) {
    const r = migrateFn(cur)
    const next = r.content != null ? r.content : r.code
    if (i === 0) first = next
    else assert.strictEqual(next, first, label + ' idempotent round ' + (i + 1))
    cur = next
  }
  return first
}

const HTML_CASES = [
  '<Child :a.sync="x" @click.native="f" />',
  '<li v-for="i in list" v-if="i.ok" :key="i.id">{{ i.n | upper }}</li>',
  '<keep-alive><component :is="view" /></keep-alive>',
  '<p>{{ a | f }} {{ b | g(1) | h }}</p><span :title="t | upper" />',
  '<Inner v-bind="$attrs" v-on="$listeners" />',
  '<template slot="x" slot-scope="{ y }">{{ y | z }}</template>',
  '<Foo :visible.sync="v" @keyup.enter.native="k" />',
]

const JS_CASES = [
  "export default { beforeDestroy() { this.$set(this.o, 'a', 1) }, destroyed() { this.$delete(this.o, 'a') } }",
  "export default { computed: { l() { return this.$listeners } }, methods: { r() { return this.$scopedSlots.default } } }",
  "export default { directives: { x: { bind(el) {}, inserted() {}, unbind() {} } }, filters: { upper(v) { return v } } }",
  "const C = Vue.extend({ name: 'C' }); new Vue(C).$mount('#app')",
  "export default { render(h) { return h('div', { attrs: { id: 'a' }, on: { click: this.f } }, this.$scopedSlots.default()) } }",
  "Vue.config.productionTip = false; Vue.set(obj, 'k', 1); Vue.delete(obj, 'k')",
  "export default { methods: { a() { this.$set(this.arr, idx, val) } } }",
]

const CSS_CASES = [
  '.x >>> .y { color: red }',
  '.x /deep/ .y { color: red }',
  '.x ::v-deep .y { color: red }',
  '.x ::v-deep(.y .z) { color: red }',
]

function synthHtml(i) {
  const id = 's' + i
  return [
    '<div>',
    '  <Comp :title.sync="' + id + '" @click.native="on' + i + '" />',
    '  <li v-for="item in list' + i + '" v-if="item.ok" :key="item.id">{{ item.n | upper | wrap(\'' + id + '\') }}</li>',
    '  <keep-alive><component :is="view' + i + '" /></keep-alive>',
    '  <Child v-on="$listeners" :label="lab | trunc(8)" />',
    '</div>',
  ].join('\n')
}

function synthJs(i) {
  return [
    'export default {',
    '  name: "S' + i + '",',
    '  filters: { upper(v) { return String(v).toUpperCase() }, wrap(v, p) { return p + v } },',
    '  directives: { focus' + i + ': { bind(el) { el.focus() }, unbind(el) { el.blur && el.blur() } } },',
    '  beforeDestroy() { this.$set(this.bag, "k' + i + '", 1) },',
    '  destroyed() { this.$delete(this.bag, "k' + i + '") },',
    '  computed: { lis() { return this.$listeners }, slot() { return this.$scopedSlots.default } },',
    '  render(h) { return h("div", { attrs: { id: "s' + i + '" }, on: { click: this.x } }, [this.$scopedSlots.default && this.$scopedSlots.default()]) }',
    '}',
  ].join('\n')
}

function synthVue(i) {
  return [
    '<template>',
    synthHtml(i),
    '</template>',
    '<script>',
    synthJs(i),
    '</script>',
    '<style scoped>',
    '.host' + i + ' >>> .inner { color: #f00 }',
    '.host' + i + ' ::v-deep .x { color: #0f0 }',
    '</style>',
  ].join('\n')
}

function main() {
  const args = parseArgs(process.argv)
  console.log('auto-migrate stress rounds=%d synth=%d', args.rounds, args.synth)

  console.log('== unit html cases ==')
  HTML_CASES.forEach((src, i) => {
    let cur = src
    let first = null
    for (let r = 0; r < 3; r += 1) {
      const next = migrateHtmlTemplate(cur).code
      if (r === 0) first = next
      else assert.strictEqual(next, first, 'html#' + i + ' idempotent')
      cur = next
    }
    assertCleanHtml(first, 'html#' + i)
  })
  console.log('  ok: %d html cases', HTML_CASES.length)

  console.log('== unit js cases ==')
  JS_CASES.forEach((src, i) => {
    let cur = src
    let first = null
    for (let r = 0; r < 3; r += 1) {
      let code = cur
      ;[migrateRenderH, migrateApiCompat, migrateDirectiveHooks, migrateFiltersOption, migrateExtend, migrateMount].forEach(
        (fn) => {
          const res = fn(code, 'case' + i + '.js')
          if (res.changes && res.changes.length) code = res.code
        }
      )
      if (r === 0) first = code
      else assert.strictEqual(code, first, 'js#' + i + ' idempotent')
      cur = code
    }
    assertCleanJs(first, 'js#' + i)
  })
  console.log('  ok: %d js cases', JS_CASES.length)

  console.log('== unit css cases ==')
  CSS_CASES.forEach((src, i) => {
    let cur = src
    let first = null
    for (let r = 0; r < 3; r += 1) {
      const next = migrateCssDeep(cur).code
      if (r === 0) first = next
      else assert.strictEqual(next, first, 'css#' + i + ' idempotent')
      cur = next
    }
    assertCleanCss(first, 'css#' + i)
  })
  console.log('  ok: %d css cases', CSS_CASES.length)

  console.log('== fixture vue files ==')
  const root = path.resolve(__dirname, '../../1.pure-vue-app/src')
  const files = fg.sync(['**/*.{vue,js}'], { cwd: root, absolute: true })
  let n = 0
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8')
    if (!/beforeDestroy|\$set|\$listeners|\.sync|filters\s*:|::v-deep|\/deep\/|>>>|v-for=[\s\S]{0,80}v-if=|Vue\.extend|\$mount|render\s*\(\s*h/.test(src)) {
      return
    }
    const rel = path.relative(root, f)
    let cur = src
    let first = null
    for (let r = 0; r < Math.min(3, args.rounds); r += 1) {
      const out = /\.vue$/i.test(f)
        ? migrateVueFile(cur, f)
        : (() => {
            let code = cur
            let changes = []
            ;[
              migrateRenderH,
              migrateApiCompat,
              migrateDirectiveHooks,
              migrateFiltersOption,
              migrateExtend,
              migrateMount,
            ].forEach((fn) => {
              const res = fn(code, f)
              if (res.changes && res.changes.length) {
                code = res.code
                changes = changes.concat(res.changes)
              }
            })
            return { content: code, changes }
          })()
      const next = out.content
      if (r === 0) first = next
      else assert.strictEqual(next, first, rel + ' idempotent')
      cur = next
    }
    if (/\.vue$/i.test(f)) {
      assertCleanHtml(first, rel)
      assertCleanCss(first, rel)
    }
    assertCleanJs(first, rel)
    n += 1
  })
  console.log('  ok: %d fixture files', n)

  console.log('== synth multi-round ==')
  for (let i = 0; i < args.synth; i += 1) {
    const src = synthVue(i)
    let cur = src
    let first = null
    for (let r = 0; r < args.rounds; r += 1) {
      const out = migrateVueFile(cur, 'synth' + i + '.vue')
      if (r === 0) first = out.content
      else assert.strictEqual(out.content, first, 'synth' + i + ' idempotent@' + r)
      cur = out.content
    }
    assertCleanHtml(first, 'synth' + i)
    assertCleanJs(first, 'synth' + i)
    assertCleanCss(first, 'synth' + i)
    if (i && i % 40 === 0) console.log('  … %d/%d', i, args.synth)
  }
  console.log('  ok: %d synth × %d rounds', args.synth, args.rounds)

  console.log('\nauto-migrate stress PASSED')
}

main()

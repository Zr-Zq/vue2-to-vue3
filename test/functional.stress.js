/**
 * Multi-round stress for functional migration
 *   node test/functional.stress.js
 *   node test/functional.stress.js --rounds 20 --synth 200
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const {
  stripTemplateFunctionalAttr,
  migrateFunctionalTemplate,
  migrateFunctionalScript,
} = require('../src/transform/functional')
const { applySfcTransforms } = require('../src/transform/apply-sfc')
const { migrateRenderH } = require('../src/transform/js-render-h')

function parseArgs(argv) {
  const args = { rounds: 15, synth: 150 }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--rounds') args.rounds = Math.max(1, Number(argv[++i]) || 15)
    else if (argv[i] === '--synth') args.synth = Math.max(0, Number(argv[++i]) || 150)
  }
  return args
}

function migrateVue(src, filename) {
  let content = String(src || '').replace(
    /^[ \t]*\/\*\s*(?:迁移脚本注释:\s*)?AI-TODO:?[\s\S]*?\*\/[ \t]*\r?\n/gm,
    (m) => (/\[functional\]/.test(m) ? '' : m)
  )
  const strip = stripTemplateFunctionalAttr(content)
  content = strip.code
  let out = applySfcTransforms(
    content,
    filename || 'anon.vue',
    (tpl) => migrateFunctionalTemplate(tpl),
    (js) => {
      let code = js
      let changes = []
      const a = migrateFunctionalScript(code, filename)
      if (a.changes.length) {
        code = a.code
        changes = changes.concat(a.changes)
      }
      const b = migrateRenderH(code, filename)
      if (b.changes.length) {
        code = b.code
        changes = changes.concat(b.changes)
      }
      return { code, changes: changes.concat(strip.changes) }
    }
  )
  content = out.content
  // Fallback: still rewrite template/script blocks if SFC parse fails
  if (
    /v-on\s*=\s*["']listeners["']/.test(content) ||
    /\bfunctional\s*:\s*true\b/.test(content) ||
    /(?:^|[^$])\bprops\./.test((content.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i) || [])[1] || '')
  ) {
    content = content.replace(/(<template\b[^>]*>)([\s\S]*?)(<\/template>)/i, (full, open, body, close) => {
      const r = migrateFunctionalTemplate(body)
      return r.changes.length ? open + r.code + close : full
    })
    content = content.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/i, (full, open, body, close) => {
      const r = migrateFunctionalScript(body, filename + '#fb')
      return r.changes.length ? open + r.code + close : full
    })
    out = { content, changes: out.changes }
  }
  return out
}

function assertClean(code, label) {
  assert.ok(!/<template[^>]*\bfunctional\b/i.test(code), label + ': template functional')
  assert.ok(!/\bfunctional\s*:\s*true\b/.test(code), label + ': functional:true')
  assert.ok(!/\bv-on\s*=\s*["']listeners["']/.test(code), label + ': v-on listeners')
  assert.ok(!/\bv-bind\s*=\s*["']data\.attrs["']/.test(code), label + ': data.attrs')
  // Bare props. in template (coarse check; exclude $props)
  const tpl = (code.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i) || [])[1] || ''
  assert.ok(!/(^|[^$])\bprops\./.test(tpl), label + ': bare props. in template')
}

const CASES = [
  {
    name: 'heading-official',
    src: `<template functional>
  <component :is="'h'+props.level" v-bind="attrs" v-on="listeners" />
</template>
<script>export default { props: ['level'] }</script>`,
  },
  {
    name: 'data-attrs-staticClass',
    src: `<template functional>
  <span class="x" :class="data.staticClass" v-bind="data.attrs" v-on="listeners">{{ props.label }}</span>
</template>
<script>export default { functional: true, props: { label: String } }</script>`,
  },
  {
    name: 'slot-and-props-index',
    src: `<template functional>
  <button v-on="listeners"><slot>{{ props['text'] }}</slot></button>
</template>
<script>export default { functional: true, props: ['text'] }</script>`,
  },
  {
    name: 'slots-scoped',
    src: `<template functional>
  <div>{{ slots.default }} {{ scopedSlots.item }}</div>
</template>
<script>export default { functional: true }</script>`,
  },
  {
    name: 'data-on-style',
    src: `<template functional>
  <div :style="data.style" v-on="data.on">{{ props.v }}</div>
</template>
<script>export default { functional: true, props: ['v'] }</script>`,
  },
  {
    name: 'js-render-ctx',
    src: `export default {
  functional: true,
  props: ['level'],
  render(h, { props, data, children }) {
    return h('h' + props.level, data, children)
  }
}`,
    js: true,
  },
  {
    name: 'js-render-ctx-ident',
    src: `export default {
  functional: true,
  render(h, context) {
    return h('div', context.data, context.children)
  }
}`,
    js: true,
  },
]

function synth(i) {
  const mode = i % 5
  if (mode === 0) {
    return `<template functional>
  <span v-bind="data.attrs" v-on="listeners">{{ props.t${i} }}</span>
</template>
<script>export default { functional: true, props: { t${i}: String } }</script>`
  }
  if (mode === 1) {
    return `<template functional>
  <component :is="props.tag" v-bind="attrs" v-on="listeners"><slot/></component>
</template>
<script>export default { props: ['tag'] }</script>`
  }
  if (mode === 2) {
    return `<template functional>
  <p :class="data.staticClass" :style="data.style">{{ props['msg'] }}</p>
</template>
<script>export default { functional: true, props: ['msg'] }</script>`
  }
  if (mode === 3) {
    return `export default {
  functional: true,
  props: ['n${i}'],
  render(h, { props, listeners, children }) {
    return h('div', { on: listeners }, [String(props.n${i}), children])
  }
}`
  }
  return `<template functional>
  <div>{{ slots.default }} {{ props.x }}</div>
</template>
<script>export default { functional: true, props: ['x'] }</script>`
}

function main() {
  const args = parseArgs(process.argv)
  console.log('functional stress rounds=%d synth=%d', args.rounds, args.synth)

  console.log('== catalog cases ==')
  CASES.forEach((c) => {
    let cur = c.src
    let first = null
    for (let r = 0; r < 3; r += 1) {
      const next = c.js
        ? migrateFunctionalScript(cur, c.name + '.js').code
        : migrateVue(cur, c.name + '.vue').content
      if (r === 0) first = next
      else assert.strictEqual(next, first, c.name + ' idempotent')
      cur = next
    }
    assertClean(first, c.name)
    console.log('  ok:', c.name)
  })

  console.log('== fixtures ==')
  const root = path.resolve(__dirname, '../../1.pure-vue-app/src')
  const files = fg.sync(['**/*.{vue,js}'], { cwd: root, absolute: true })
  let n = 0
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8')
    if (!/<template[^>]*\bfunctional\b/i.test(src) && !/\bfunctional\s*:\s*true\b/.test(src)) return
    const rel = path.relative(root, f)
    let cur = src
    let first = null
    for (let r = 0; r < Math.min(3, args.rounds); r += 1) {
      const next = /\.vue$/i.test(f)
        ? migrateVue(cur, f).content
        : migrateFunctionalScript(cur, f).code
      if (r === 0) first = next
      else assert.strictEqual(next, first, rel + ' idempotent')
      cur = next
    }
    assertClean(first, rel)
    n += 1
    console.log('  ok:', rel)
  })
  console.log('  fixtures:', n)

  console.log('== synth ==')
  for (let i = 0; i < args.synth; i += 1) {
    const src = synth(i)
    const isJs = /^\s*export default/.test(src)
    let cur = src
    let first = null
    for (let r = 0; r < args.rounds; r += 1) {
      const next = isJs
        ? migrateFunctionalScript(cur, 's' + i + '.js').code
        : migrateVue(cur, 's' + i + '.vue').content
      if (r === 0) first = next
      else assert.strictEqual(next, first, 'synth' + i + '@' + r)
      cur = next
    }
    assertClean(first, 'synth' + i)
    if (i && i % 50 === 0) console.log('  …', i, '/', args.synth)
  }
  console.log('  ok: %d synth × %d rounds', args.synth, args.rounds)
  console.log('\nfunctional stress PASSED')
}

main()

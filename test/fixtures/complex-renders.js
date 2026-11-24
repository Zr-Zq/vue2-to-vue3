/**
 * 复杂 render(h) 样本（供压力测 / 单测复用）
 */
module.exports = [
  {
    id: 'nested-h-tree',
    src: `
export default {
  name: 'NestedTree',
  props: { items: Array },
  render(h) {
    return h('div', { class: 'wrap', attrs: { 'data-root': '1' } }, [
      h('ul', this.items.map((it) =>
        h('li', { key: it.id, on: { click: () => this.pick(it) } }, [
          h('span', { attrs: { title: it.name } }, it.name),
          it.kids && it.kids.length
            ? h('ul', it.kids.map((k) => h('li', { key: k }, k)))
            : null,
        ])
      )),
    ])
  },
  methods: { pick() {} },
}
`,
    assert(code) {
      return (
        /render\s*\(\s*\)\s*\{/.test(code) &&
        /import\s*\{[^}]*\bh\b/.test(code) &&
        !/render\s*\(\s*h\s*\)/.test(code)
      )
    },
  },
  {
    id: 'jsx-like-mixed-on-attrs-domProps',
    src: `
import Vue from 'vue'
export default {
  render(h) {
    return h('input', {
      attrs: { type: 'text', placeholder: 'x', id: 'inp' },
      domProps: { value: this.val },
      on: {
        input: (e) => { this.val = e.target.value },
        focus: this.onFocus,
        'custom-evt': this.onCustom,
      },
      style: { color: 'red' },
      class: ['a', { b: true }],
      key: 'k1',
      ref: 'inp',
    })
  },
}
`,
    assert(code) {
      return (
        /import\s+Vue\s*,\s*\{[^}]*\bh\b/.test(code) &&
        /render\s*\(\s*\)\s*\{/.test(code) &&
        (/onInput/.test(code) || /onFocus/.test(code)) &&
        (/onCustom-evt/.test(code) || /"onCustom-evt"/.test(code) || /onCustom/.test(code))
      )
    },
  },
  {
    id: 'scoped-slots-and-default',
    src: `
export default {
  functional: false,
  render(h) {
    const def = this.$scopedSlots.default
    const title = this.$scopedSlots.title
    return h('section', [
      title ? title({ text: this.t }) : h('h1', this.t),
      def ? def({ n: 1 }) : null,
      this.$slots.footer,
    ])
  },
}
`,
    assert(code) {
      return (
        /this\.\$slots\.default/.test(code) &&
        /this\.\$slots\.title/.test(code) &&
        !/this\.\$scopedSlots\b/.test(code)
      )
    },
  },
  {
    id: 'arrow-render-property',
    src: `const App = { template: '<div/>' }
export default {
  render: (h) => h('div', { attrs: { id: 'app' } }, [h(App), h('span', 'x')]),
}
`,
    assert(code) {
      return !/render:\s*\(\s*h\s*\)/.test(code) && /import\s*\{[^}]*\bh\b/.test(code)
    },
  },
  {
    id: 'function-expression-render',
    src: `
export default {
  render: function (h) {
    const child = h.bind(null)
    return h('div', [child('span', { on: { click: function () {} } }, 'a')])
  },
}
`,
    assert(code) {
      // h 参数去掉；h.bind 里的 h 是标识符调用，应仍存在
      return /render:\s*function\s*\(\s*\)\s*\{/.test(code) && /\bh\b/.test(code)
    },
  },
  {
    id: 'multi-render-in-file',
    src: `
const A = {
  render(h) { return h('a') },
}
const B = {
  render(h) { return h('b', { attrs: { x: 1 }, on: { click: () => {} } }) },
}
export default {
  render(h) {
    return h('div', [h(A), h(B)])
  },
}
`,
    assert(code) {
      const hits = code.match(/\brender\s*\(\s*h\s*\)/g)
      return !hits && (code.match(/\brender\s*\(\s*\)\s*\{/g) || []).length >= 3
    },
  },
  {
    id: 'ternary-and-spread-children',
    src: `
export default {
  render(h) {
    const kids = [h('i', '1'), h('i', '2')]
    return this.show
      ? h('div', { class: 'on', on: { mouseenter: this.enter } }, [...kids, this.$scopedSlots.extra && this.$scopedSlots.extra()])
      : h('div', { class: 'off' })
  },
}
`,
    assert(code) {
      return (
        /render\s*\(\s*\)\s*\{/.test(code) &&
        !/this\.\$scopedSlots\b/.test(code) &&
        /this\.\$slots\.extra/.test(code)
      )
    },
  },
  {
    id: 'createElement-alias-not-touched',
    // 参数名不是 h 时不应误伤；但若有 $scopedSlots 仍改
    src: `
export default {
  render(createElement) {
    return createElement('div', this.$scopedSlots.default && this.$scopedSlots.default())
  },
}
`,
    assert(code) {
      return (
        /render\s*\(\s*createElement\s*\)/.test(code) &&
        /this\.\$slots\.default/.test(code) &&
        !/this\.\$scopedSlots\b/.test(code)
      )
    },
  },
  {
    id: 'already-vue3-idempotent',
    src: `
import { h } from 'vue'
export default {
  render() {
    return h('div', { id: 'ok', onClick: () => {} }, 'done')
  },
}
`,
    assert(code) {
      return (
        /import\s*\{\s*h\s*\}\s*from\s*['"]vue['"]/.test(code) &&
        /render\s*\(\s*\)\s*\{/.test(code) &&
        (code.match(/import\s*\{[^}]*\bh\b/g) || []).length === 1
      )
    },
  },
  {
    id: 'huge-flat-list',
    src: (() => {
      const items = []
      for (let i = 0; i < 80; i += 1) {
        items.push(
          `h('li', { key: ${i}, attrs: { 'data-i': '${i}' }, on: { click: () => this.sel(${i}) } }, 'item-${i}')`
        )
      }
      return `
export default {
  render(h) {
    return h('ul', { attrs: { role: 'list' }, on: { scroll: this.onScroll } }, [
      ${items.join(',\n      ')}
    ])
  },
  methods: { sel() {}, onScroll() {} },
}
`
    })(),
    assert(code) {
      return /render\s*\(\s*\)\s*\{/.test(code) && !/render\s*\(\s*h\s*\)/.test(code)
    },
  },
  {
    id: 'vue-sfc-script-wrap',
    sfc: true,
    src: `<template><div /></template>
<script>
export default {
  name: 'SfcComplex',
  render(h) {
    return h('div', {
      attrs: { 'data-cc': 'x' },
      on: { click: this.onClick },
    }, [
      this.$scopedSlots.default ? this.$scopedSlots.default({ n: 2 }) : null,
      h('span', { domProps: { innerHTML: this.html } }),
    ])
  },
}
</script>
`,
    assert(code) {
      return (
        /<script>/.test(code) &&
        /import\s*\{\s*h\s*\}\s*from\s*['"]vue['"]/.test(code) &&
        /render\s*\(\s*\)\s*\{/.test(code) &&
        !/this\.\$scopedSlots\b/.test(code)
      )
    },
  },
  {
    id: 'router-view-render',
    src: `
import Layout from './Layout.vue'
export default {
  path: '/x',
  component: {
    render(h) {
      return h(Layout, { props: { dark: true }, on: { nav: this.onNav } }, [
        h('router-view'),
      ])
    },
  },
}
`,
    assert(code) {
      return /render\s*\(\s*\)\s*\{/.test(code) && /import\s*\{[^}]*\bh\b/.test(code)
    },
  },
]

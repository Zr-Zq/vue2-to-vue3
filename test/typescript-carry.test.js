/**
 * TS type carry (ref/props) + class decorator AI-TODO
 *   node test/typescript-carry.test.js
 */
const assert = require('assert')
const { migrateOptionsToComposition } = require('../src/transform/options-to-composition')
const { listDecorators, insertClassAiTodo } = require('../src/pipeline/plugins/typescript')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== data() return type to ref<T> (carry only) ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data(): { count: number; label: string } {
        return { count: 0, label: 'x' }
      },
      methods: {
        inc(): number { this.count++; return this.count }
      }
    }`,
    { filename: 'typed.ts' }
  )
  ok(/ref<\s*number\s*>\s*\(\s*0\s*\)/.test(r.code), 'ref<number>(0)')
  ok(/ref<\s*string\s*>\s*\(\s*['"]x['"]\s*\)/.test(r.code), 'ref<string>(…)')
  ok(/function inc\(\)\s*:\s*number/.test(r.code), 'method return type kept')
  ok(r.changes.some((c) => c.kind === 'data-to-ref' && c.typed), 'typed data-to-ref')
}

console.log('== no invented types when annotation missing ==')
{
  const r = migrateOptionsToComposition(
    `export default {
      data() { return { count: 0 } }
    }`
  )
  ok(/const count = ref\(0\)/.test(r.code), 'plain ref(0)')
  ok(!/ref\s*</.test(r.code), 'no type params invented')
}

console.log('== PropType preserved in defineProps ==')
{
  const r = migrateOptionsToComposition(
    `import { PropType } from 'vue'
    export default {
      props: {
        user: { type: Object as PropType<{ id: number }>, required: true }
      },
      data() { return { n: 1 } }
    }`,
    { filename: 'props.ts' }
  )
  ok(/defineProps\(/.test(r.code), 'defineProps')
  ok(/PropType/.test(r.code), 'PropType kept')
  ok(/id:\s*number/.test(r.code), 'inner type kept')
}

console.log('== class decorators listed + AI-TODO ==')
{
  const src = `
    import { Component, Prop, Watch } from 'vue-property-decorator'
    @Component
    export default class Foo {
      @Prop() name!: string
      @Watch('name') onName() {}
    }
  `
  const list = listDecorators(src)
  ok(list.includes('@Component'), '@Component listed')
  ok(list.includes('@Prop'), '@Prop listed')
  ok(list.includes('@Watch'), '@Watch listed')
  ok(list.includes('vue-property-decorator'), 'pkg listed')
  const r = insertClassAiTodo(src, list)
  ok(r.inserted, 'AI-TODO inserted')
  ok(/AI-TODO:\s*\[typescript-class\]/.test(r.code), 'typescript-class marker')
  ok(/Convert to Options API first/.test(r.code), 'docs hint present')
  const again = insertClassAiTodo(r.code, list)
  ok(!again.inserted, 'idempotent AI-TODO')
}

console.log('typescript-carry tests passed')
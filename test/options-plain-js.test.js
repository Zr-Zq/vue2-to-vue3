const assert = require('assert')
const path = require('path')
const plugin = require('../src/pipeline/plugins/migrate-options-composition')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

function makeCtx(content, ext, filePath) {
  const ctx = {
    file: {
      content,
      ext,
      kind: ext === '.vue' ? 'vue' : 'js',
      path: filePath || 'src/mixins/foo' + ext,
      absPath: path.resolve('src/mixins/foo' + ext),
    },
    setContent(next) {
      this.file.content = next
    },
    report() {},
  }
  return ctx
}

async function main() {
  console.log('== plain .js mixin: AI-TODO only, keep export default ==')
  {
    const src = `export default {
  data() { return { x: 1 } },
  methods: {
    ping() { return this.x }
  }
}
`
    const ctx = makeCtx(src, '.js', 'src/mixins/demo.js')
    const matched = plugin.match(ctx, { options: {} })
    ok(matched, 'plugin matches plain Options .js')
    await plugin.transform(ctx, { options: {}, project: { shared: {} } })
    ok(/export\s+default\s*\{/.test(ctx.file.content), 'export default preserved')
    ok(/AI-TODO:\s*\[options-to-composition\]/.test(ctx.file.content), 'AI-TODO added')
    ok(!/const x = ref/.test(ctx.file.content), 'did not emit script-setup refs')
    ok(/methods:\s*\{/.test(ctx.file.content), 'methods block kept')
  }

  console.log('== plain .js without Options: no match ==')
  {
    const ctx = makeCtx('export const x = 1\n', '.js')
    ok(!plugin.match(ctx, { options: {} }), 'plain module not matched')
  }

  console.log('\noptions-plain-js tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

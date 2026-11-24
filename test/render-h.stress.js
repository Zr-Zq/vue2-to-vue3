/**
 * render migration stress: complex samples + real project + multi-round idempotence + synth volume
 *
 *   node test/render-h.stress.js
 *   node test/render-h.stress.js --rounds 20 --synth 200
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob')
const { migrateRenderH } = require('../src/transform/js-render-h')
const { applySfcTransforms } = require('../src/transform/apply-sfc')
const complex = require('./fixtures/complex-renders')

function parseArgs(argv) {
  const args = { rounds: 10, synth: 100 }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--rounds') args.rounds = Math.max(1, Number(argv[++i]) || 10)
    else if (argv[i] === '--synth') args.synth = Math.max(0, Number(argv[++i]) || 100)
  }
  return args
}

function migrateAny(src, filename, isSfc) {
  if (isSfc || /\.vue$/i.test(filename) || /<script[\s>]/.test(src)) {
    return applySfcTransforms(src, filename || 'anon.vue', null, (js) =>
      migrateRenderH(js, filename || 'anon.vue')
    )
  }
  const r = migrateRenderH(src, filename || 'anon.js')
  return { content: r.code, changes: r.changes, error: r.error }
}

function stripCommentsAndStrings(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, '""')
}

function assertNoRenderH(code) {
  const c = stripCommentsAndStrings(code)
  // Only function-form render(h); avoid false hits in template prose / desc strings
  return (
    !/\brender\s*\(\s*h\s*\)\s*\{/.test(c) &&
    !/\brender\s*:\s*\(\s*h\s*\)\s*=>/.test(c) &&
    !/\brender\s*:\s*function\s*\(\s*h\s*\)\s*\{/.test(c)
  )
}

function synthCase(i) {
  const depth = 2 + (i % 4)
  function tree(d, n) {
    // n must be a valid identifier suffix (avoid digit-then-letter like 0a)
    const id = 'n' + n
    if (d <= 0) {
      return (
        "h('span', { attrs: { 'data-n': '" +
        id +
        "' }, on: { click: () => this.t('" +
        id +
        "') } }, '" +
        id +
        "')"
      )
    }
    return (
      "h('div', { class: 'd" +
      d +
      "', attrs: { id: '" +
      id +
      "' }, on: { mouseenter: this.enter } }, [" +
      tree(d - 1, n + 'a') +
      ', ' +
      tree(d - 1, n + 'b') +
      '])'
    )
  }
  return {
    id: 'synth-' + i,
    src:
      '\nexport default {\n' +
      "  name: 'Synth" +
      i +
      "',\n" +
      '  render(h) {\n' +
      '    const slot = this.$scopedSlots.cell\n' +
      "    return h('section', { attrs: { 'data-i': '" +
      i +
      "' } }, [\n" +
      '      slot ? slot({ i: ' +
      i +
      ' }) : null,\n' +
      '      ' +
      tree(depth, String(i)) +
      '\n' +
      '    ])\n' +
      '  },\n' +
      '  methods: { t() {}, enter() {} },\n' +
      '}\n',
    assert(code) {
      return (
        assertNoRenderH(code) &&
        /this\.\$slots\.cell/.test(code) &&
        /import\s*\{[^}]*\bh\b/.test(code)
      )
    },
  }
}

function runCase(c, tag) {
  const r = migrateAny(c.src, c.id + (c.sfc ? '.vue' : '.js'), c.sfc)
  if (r.error) throw new Error(tag + ' parse/migrate error: ' + r.error)
  if (typeof c.assert === 'function') {
    assert.ok(c.assert(r.content), tag + ' custom assert failed')
  } else {
    assert.ok(assertNoRenderH(r.content), tag + ' still has render(h)')
  }
  return r
}

function idempotentRounds(src, filename, isSfc, rounds) {
  let cur = src
  let totalChanges = 0
  const perRound = []
  for (let i = 0; i < rounds; i += 1) {
    const r = migrateAny(cur, filename, isSfc)
    const n = (r.changes || []).length
    perRound.push(n)
    totalChanges += n
    cur = r.content
    // From round 2, changes should drop to ~0 (tiny remainder like comment cleanup ok)
    if (i >= 1) {
      assert.ok(n <= 1, filename + ' round ' + (i + 1) + ' still changing ×' + n)
    }
  }
  // Final stability: one more round must be 0
  const last = migrateAny(cur, filename, isSfc)
  assert.strictEqual((last.changes || []).length, 0, filename + ' not stable at end')
  return { perRound, totalChanges, final: cur }
}

function main() {
  const args = parseArgs(process.argv)
  const t0 = Date.now()
  let passed = 0
  let failed = 0
  const failures = []

  console.log('=== A. complex samples (' + complex.length + ') ===')
  complex.forEach((c) => {
    try {
      runCase(c, c.id)
      const idemp = idempotentRounds(c.src, c.id, c.sfc, 3)
      console.log('  ok', c.id, 'idempotent', idemp.perRound.join('→'))
      passed += 1
    } catch (e) {
      failed += 1
      failures.push({ id: c.id, err: e.message })
      console.error('  FAIL', c.id, e.message)
    }
  })

  console.log('\n=== B. real project files with render ===')
  const appRoot = path.resolve(__dirname, '../../1.pure-vue-app')
  const files = fg.sync(['src/**/*.{js,vue}'], {
    cwd: appRoot,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
  const renderFiles = files.filter((f) => {
    const txt = fs.readFileSync(f, 'utf8')
    return /\brender\s*\(\s*h\s*\)|\brender\s*:\s*\(\s*h\s*\)|\$scopedSlots/.test(txt)
  })
  console.log('  hits', renderFiles.length, 'files')
  renderFiles.forEach((abs) => {
    const rel = path.relative(appRoot, abs).split(path.sep).join('/')
    try {
      const raw = fs.readFileSync(abs, 'utf8')
      const r1 = migrateAny(raw, abs, /\.vue$/i.test(abs))
      assert.ok(!r1.error, rel + ' ' + r1.error)
      // Ignore "render(h)" text inside comments/strings (e.g. desc fields)
      assert.ok(assertNoRenderH(r1.content), rel + ' still render(h) in code')
      const codeOnly = stripCommentsAndStrings(r1.content)
      assert.ok(!/this\.\$scopedSlots\b/.test(codeOnly), rel + ' still $scopedSlots')
      const idemp = idempotentRounds(raw, abs, /\.vue$/i.test(abs), 3)
      console.log('  ok', rel, 'changes1=' + (r1.changes || []).length, 'idem', idemp.perRound.join('→'))
      passed += 1
    } catch (e) {
      failed += 1
      failures.push({ id: rel, err: e.message })
      console.error('  FAIL', rel, e.message)
    }
  })

  console.log('\n=== C. synthetic samples ×' + args.synth + ' ===')
  const tSynth0 = Date.now()
  for (let i = 0; i < args.synth; i += 1) {
    const c = synthCase(i)
    try {
      runCase(c, c.id)
      if (i % 20 === 0 || i === args.synth - 1) {
        const idemp = idempotentRounds(c.src, c.id, false, 2)
        process.stdout.write(
          '  synth ' + (i + 1) + '/' + args.synth + ' idem ' + idemp.perRound.join('→') + '\n'
        )
      }
      passed += 1
    } catch (e) {
      failed += 1
      failures.push({ id: c.id, err: e.message })
      if (failures.length <= 5) console.error('  FAIL', c.id, e.message)
    }
  }
  const synthMs = Date.now() - tSynth0
  console.log('  synth time', synthMs + 'ms', 'avg', (synthMs / Math.max(1, args.synth)).toFixed(2) + 'ms/case')

  console.log('\n=== D. full re-runs ×' + args.rounds + ' ===')
  const batch = complex.concat(renderFiles.slice(0, 8).map((abs) => ({
    id: path.basename(abs),
    src: fs.readFileSync(abs, 'utf8'),
    sfc: /\.vue$/i.test(abs),
    assert: (code) => assertNoRenderH(code),
  })))
  const roundTimes = []
  for (let r = 1; r <= args.rounds; r += 1) {
    const rt0 = Date.now()
    batch.forEach((c) => {
      const out = runCase(c, 'R' + r + ':' + c.id)
      // Re-migrating the output should be stable
      const again = migrateAny(out.content, c.id, c.sfc)
      assert.ok((again.changes || []).length <= 1, 'R' + r + ' ' + c.id + ' not stable')
    })
    const ms = Date.now() - rt0
    roundTimes.push(ms)
    console.log('  round', r, ms + 'ms')
    passed += 1
  }

  const totalMs = Date.now() - t0
  console.log('\n=== summary ===')
  console.log('passed=', passed, 'failed=', failed, 'totalMs=', totalMs)
  console.log(
    'round ms: min/avg/max',
    Math.min.apply(null, roundTimes),
    '/',
    Math.round(roundTimes.reduce((a, b) => a + b, 0) / roundTimes.length),
    '/',
    Math.max.apply(null, roundTimes)
  )
  if (failures.length) {
    console.error('failures:')
    failures.slice(0, 20).forEach((f) => console.error(' -', f.id, f.err))
    process.exit(1)
  }
  console.log('render-h stress PASSED')
}

main()

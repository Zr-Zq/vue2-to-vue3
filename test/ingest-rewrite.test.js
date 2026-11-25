const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ingestFiles, INGEST_GLOBS, isCodeExt, isBinaryExt } = require('../src/ingest')
const { stripExt, formatImportForBase } = require('../src/rewrite-imports')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== stripExt keeps .vue ==')
{
  ok(stripExt('views/Foo.vue') === 'views/Foo.vue', 'keep .vue')
  ok(stripExt('utils/bar.js') === 'utils/bar', 'strip .js')
  ok(stripExt('a/b.ts') === 'a/b', 'strip .ts')
  ok(stripExt('./Comp.vue') === './Comp.vue', 'relative .vue kept')
}

console.log('== formatImportForBase keeps .vue under alias ==')
{
  const root = path.join(os.tmpdir(), 'v23-alias-proj')
  const baseConfig = {
    root,
    alias: { '@': path.join(root, 'src') },
  }
  const formatted = formatImportForBase(
    path.join(root, 'src', 'views', 'Home.vue'),
    path.join(root, 'src', 'main.js'),
    baseConfig
  )
  ok(formatted === '@/views/Home.vue', 'alias import keeps .vue: ' + formatted)
}

console.log('== ingest globs include styles ==')
{
  ok(INGEST_GLOBS.some((g) => g.includes('scss')), 'scss in globs')
  ok(INGEST_GLOBS.some((g) => g.includes('css')), 'css in globs')
  ok(INGEST_GLOBS.some((g) => g.includes('png')), 'png in globs')
  ok(isCodeExt('.vue') && isCodeExt('.js'), 'code exts')
  ok(isBinaryExt('.png') && isBinaryExt('.woff2'), 'binary exts')
  ok(!isCodeExt('.scss') && !isBinaryExt('.scss'), 'scss is text asset')
}

console.log('== ingest copies scss (not only vue/js) ==')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-ingest-'))
  const src = path.join(tmp, 'from')
  const destRoot = path.join(tmp, 'to')
  const destSrc = path.join(destRoot, 'src')
  fs.mkdirSync(path.join(src, 'styles'), { recursive: true })
  fs.mkdirSync(path.join(destRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(destRoot, 'package.json'), '{"name":"to"}\n')
  fs.writeFileSync(path.join(src, 'styles', 'app.scss'), '$c: #fff;\nbody { color: $c; }\n')
  fs.writeFileSync(path.join(src, 'Hello.vue'), '<template><div/></template>\n<script>export default {}</script>\n')
  fs.writeFileSync(path.join(src, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  const result = ingestFiles({
    from: src,
    to: destSrc,
    sourceRoot: tmp,
    baseRoot: destRoot,
    backup: false,
  })

  const scssTo = path.join(destSrc, 'styles', 'app.scss')
  const pngTo = path.join(destSrc, 'icon.png')
  const vueTo = path.join(destSrc, 'Hello.vue')
  ok(fs.existsSync(scssTo), 'scss copied')
  ok(fs.existsSync(pngTo), 'png copied')
  ok(fs.existsSync(vueTo), 'vue copied')
  ok(fs.readFileSync(scssTo, 'utf8').includes('$c'), 'scss content intact')
  ok(result.files.some((f) => f.binary && /icon\.png$/.test(f.toAbs.replace(/\\/g, '/'))), 'png marked binary')
}

console.log('\ningest-rewrite tests passed')

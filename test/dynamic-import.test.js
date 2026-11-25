const assert = require('assert')
const path = require('path')
const { migrateDynamicImport } = require('../src/transform/js-dynamic-import')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok: ' + msg)
}

const root = path.resolve('/proj')
const importer = path.join(root, 'src', 'router', 'index.js')

console.log('== @/ alias + concatenation → import.meta.glob (relative to importer) ==')
{
  const r = migrateDynamicImport(
    `import Layout from '@/layout/index.vue'
const routes = list.map((c) => ({ path: c.path, component: () => import('@/fixtures/composition/' + c.path + '.vue') }))`,
    { filename: importer, projectRoot: root }
  )
  ok(/const __v23Glob0 = import\.meta\.glob\(["']\.\.\/fixtures\/composition\/\*\*\/\*\.vue["']\)/.test(r.code), 'glob pattern relative + recursive')
  ok(/component: \(\) => __v23LoadGlob\(__v23Glob0, ["']\.\.\/fixtures\/composition\/["'] \+ c\.path \+ ["']\.vue["']\)/.test(r.code), 'lookup key rebuilt with relative prefix')
  ok(/const __v23LoadGlob = \(map, key\) => map\[key\] \? map\[key\]\(\) : Promise\.reject/.test(r.code), 'loader helper rejects like webpack')
  ok(r.code.indexOf('__v23Glob0 =') > r.code.indexOf("from '@/layout/index.vue'"), 'declared after imports')
}

console.log('== template literal + file-name prefix; same pattern shared ==')
{
  const r = migrateDynamicImport(
    'const a = () => import(`./pages/page-${n}.vue`)\nconst b = () => import(`./pages/page-${m}.vue`)',
    { filename: importer, projectRoot: root }
  )
  ok(/import\.meta\.glob\(["']\.\/pages\/\*\*\/page-\*\.vue["']\)/.test(r.code), 'file prefix kept in pattern')
  ok((r.code.match(/import\.meta\.glob/g) || []).length === 1, 'one glob per pattern')
  ok(/__v23LoadGlob\(__v23Glob0, `\.\/pages\/page-\$\{n\}\.vue`\)/.test(r.code), 'template key kept')
}

console.log('== out of scope: no extension / bare package / static string ==')
{
  const src = "const a = () => import('@/views/' + name)\nconst b = () => import('lodash/' + m + '.js')\nconst c = () => import('./x.vue')"
  const r = migrateDynamicImport(src, { filename: importer, projectRoot: root })
  ok(r.code === src && !r.changes.length, 'left untouched')
}

console.log('\ndynamic-import tests passed')

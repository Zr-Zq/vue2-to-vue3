/**
 * HTML rewrite unit tests: sync / native / slot / v-for+v-if / keep-alive:key
 *   node test/html-migrate.test.js
 */
const assert = require('assert')
const {
  migrateHtmlTemplate,
  rewriteSync,
  rewriteVForVIf,
  rewriteKeepAliveIsKey,
} = require('../src/transform/html-directives')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== sync: must become v-model:prop, not only drop .sync ==')
{
  const r = rewriteSync('<Child :title.sync="t" :visible.sync="v" />')
  ok(/v-model:title="t"/.test(r.code), 'title to v-model:title')
  ok(/v-model:visible="v"/.test(r.code), 'visible to v-model:visible')
  ok(!/\.sync/.test(r.code), 'no .sync left')
  // Counterexample: stripping sync alone would leave one-way :title="t" (do not touch v-model:title)
  ok(!/(^|[^-\w])\:title="t"/.test(r.code), 'not one-way :title')
}

console.log('== native: drop .native ==')
{
  const r = migrateHtmlTemplate('<Eg @click.native="on" @keyup.enter.native="k" />')
  ok(/@click="on"/.test(r.code), '@click.native to @click')
  ok(/@keyup\.enter="k"/.test(r.code), 'keep other modifiers')
  ok(!/\.native/.test(r.code), 'no .native')
}

console.log('== slots unify to # ==')
{
  const src = [
    '<Host>',
    '  <template slot="header">H</template>',
    '  <template slot="body" slot-scope="{ ok }">{{ ok }}</template>',
    '  <span slot="footer">F</span>',
    '  <template #modern>M</template>',
    '</Host>',
  ].join('\n')
  const r = migrateHtmlTemplate(src)
  ok(/#header/.test(r.code), 'slot=header to #header')
  ok(/#body="\{ ok \}"/.test(r.code) || /#body="\{ ok\}"/.test(r.code) || /#body="/.test(r.code), 'slot+scope to #body')
  ok(/#footer/.test(r.code), 'span slot wrapped with #footer')
  ok(!/\sslot=/.test(r.code), 'no legacy slot=')
  ok(!/slot-scope=/.test(r.code), 'no slot-scope')
  console.log('  out:\n' + r.code)
}

console.log('== v-for+v-if same-node left for AI (html migrate does not auto-split) ==')
{
  const src = '<li v-for="item in list" v-if="item.ok" :key="item.id">{{ item }}</li>'
  const r = migrateHtmlTemplate(src)
  ok(/v-for="item in list"/.test(r.code) && /v-if="item.ok"/.test(r.code), 'same-node combo kept for AI')
  // Helper still exists for experiments / docs, but is not part of migrateHtmlTemplate
  const helper = rewriteVForVIf(src)
  ok(helper.changes.length > 0, 'rewriteVForVIf helper still available')
}

console.log('== slot: nested same name / nested div ==')
{
  const menu = migrateHtmlTemplate(
    '<el-submenu><template slot="title"><i class="x"></i><span slot="title">纯 Vue2</span></template></el-submenu>'
  )
  ok(/<template #title>/.test(menu.code), 'outer #title')
  ok(!/<template #title><span>/.test(menu.code.replace(/\s/g, '')), 'no nested #title wrap')
  ok(/<span>纯 Vue2<\/span>/.test(menu.code), 'inner span keeps text, slot stripped')

  const card = migrateHtmlTemplate(
    '<el-card><div slot="header" class="flex-between"><span>T</span><div>inner</div></div></el-card>'
  )
  ok(/<template #header><div class="flex-between">/.test(card.code), 'header wrap')
  ok(/<\/div><\/template>/.test(card.code.replace(/\s+/g, '')), 'nested div closed before template')
  ok(!/<\/div><\/template>\s*<\/div>/.test(card.code), 'no orphan outer close')
}

console.log('== keep-alive + :is add :key ==')
{
  const r = rewriteKeepAliveIsKey(
    '<keep-alive><component :is="view" /><Foo :is="other" /></keep-alive>'
  )
  ok(/:is="view"\s*:key="view"/.test(r.code) || /:is="view"[^>]*:key="view"/.test(r.code), 'component gets :key')
  ok(/:is="other"[^>]*:key="other"/.test(r.code), 'non-component :is gets :key')
  const already = rewriteKeepAliveIsKey(
    '<keep-alive><component :is="view" :key="view" /></keep-alive>'
  )
  ok(already.changes.length === 0, 'existing :key not duplicated')
}

console.log('== template v-for :key to inner (Vue2) ==')
{
  const { rewriteTemplateVForKey } = require('../src/transform/html-directives')
  const r = rewriteTemplateVForKey(
    '<template v-for="item in list" :key="item.id"><li v-if="item.on">{{ item.text }}</li></template>'
  )
  ok(/<template v-for="item in list">/.test(r.code), 'template has no :key')
  ok(/<li[^>]*:key="item.id"/.test(r.code), 'key on li')
  ok(!/<template[^>]*:key=/.test(r.code), 'no keyed template')
}

console.log('\nhtml-migrate tests passed')

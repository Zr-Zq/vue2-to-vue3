/**
 * HTML 改写单测：sync / native / slot / v-for+v-if / keep-alive:key
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

console.log('== sync：必须变成 v-model:prop，不能只删 .sync ==')
{
  const r = rewriteSync('<Child :title.sync="t" :visible.sync="v" />')
  ok(/v-model:title="t"/.test(r.code), 'title → v-model:title')
  ok(/v-model:visible="v"/.test(r.code), 'visible → v-model:visible')
  ok(!/\.sync/.test(r.code), 'no .sync left')
  // 反例：若只删 sync 会变成单向 :title="t"（注意不要误伤 v-model:title）
  ok(!/(^|[^-\w])\:title="t"/.test(r.code), 'not one-way :title')
}

console.log('== native：去掉 .native ==')
{
  const r = migrateHtmlTemplate('<Eg @click.native="on" @keyup.enter.native="k" />')
  ok(/@click="on"/.test(r.code), '@click.native → @click')
  ok(/@keyup\.enter="k"/.test(r.code), 'keep other modifiers')
  ok(!/\.native/.test(r.code), 'no .native')
}

console.log('== slot 统一为 # ==')
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
  ok(/#header/.test(r.code), 'slot=header → #header')
  ok(/#body="\{ ok \}"/.test(r.code) || /#body="\{ ok\}"/.test(r.code) || /#body="/.test(r.code), 'slot+scope → #body')
  ok(/#footer/.test(r.code), 'span slot wrapped with #footer')
  ok(!/\sslot=/.test(r.code), 'no legacy slot=')
  ok(!/slot-scope=/.test(r.code), 'no slot-scope')
  console.log('  out:\n' + r.code)
}

console.log('== v-for+v-if 拆节点 ==')
{
  const r = rewriteVForVIf('<li v-for="item in list" v-if="item.ok" :key="item.id">{{ item }}</li>')
  ok(/<template v-for="item in list">/.test(r.code), 'outer template v-for（无 key）')
  ok(/<li[^>]*:key="item.id"/.test(r.code), 'key 在内层元素（Vue2 兼容）')
  ok(/<li[^>]*v-if="item.ok"/.test(r.code), 'inner keeps v-if')
  ok(!/<li[^>]*v-for=/.test(r.code), 'no same-node v-for')
}

console.log('== slot：嵌套同名 / 嵌套 div ==')
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

console.log('== keep-alive + :is 补 :key ==')
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

console.log('== template v-for :key → 内层（Vue2）==')
{
  const { rewriteTemplateVForKey } = require('../src/transform/html-directives')
  const r = rewriteTemplateVForKey(
    '<template v-for="item in list" :key="item.id"><li v-if="item.on">{{ item.text }}</li></template>'
  )
  ok(/<template v-for="item in list">/.test(r.code), 'template 无 :key')
  ok(/<li[^>]*:key="item.id"/.test(r.code), 'key 在 li 上')
  ok(!/<template[^>]*:key=/.test(r.code), 'no keyed template')
}

console.log('\nhtml-migrate tests passed')

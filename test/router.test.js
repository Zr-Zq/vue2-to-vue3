const assert = require('assert')
const { migrateRouterModule, migrateRouterScriptSetup } = require('../src/transform/js-router')
const { migrateAsyncComponent } = require('../src/transform/js-async-component')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok: ' + msg)
}

console.log('== router module: new VueRouter to createRouter ==')
{
  const r = migrateRouterModule(`
    import Vue, { h } from 'vue'
    import VueRouter from 'vue-router'
    import Layout from '@/layout/index.vue'
    Vue.use(VueRouter)
    export const routes = [
      { path: '/', component: Layout, children: [{ path: '*', component: Layout }] },
      { path: '/docs/*', component: Layout },
      { path: '*', component: { render() { return h('div', '404') } } },
    ]
    const router = new VueRouter({
      mode: 'history',
      base: process.env.BASE_URL,
      fallback: true,
      routes,
      scrollBehavior(to, from, saved) {
        if (saved) return saved
        return { x: 0, y: 0 }
      },
    })
    router.onReady(() => {})
    console.log(router.currentRoute.path)
    export default router
  `)
  const c = r.code
  ok(!/VueRouter/.test(c), 'no VueRouter left')
  ok(/import \{ createRouter, createWebHistory \} from ['"]vue-router['"]/.test(c), 'named imports')
  ok(!/Vue\.use/.test(c), 'Vue.use removed')
  ok(/import \{ h \} from ['"]vue['"]/.test(c), 'unused Vue default dropped, h kept')
  ok(/const router = createRouter\(\{\s*history: createWebHistory\(process\.env\.BASE_URL\)/.test(c), 'history from mode+base')
  ok(!/mode:|base:|fallback:/.test(c), 'mode/base/fallback removed')
  ok(/path: ['"]:pathMatch\(\.\*\)\*['"]/.test(c), 'relative catch-all in literal children')
  ok(/path: ['"]\/docs\/:pathMatch\(\.\*\)\*['"]/.test(c), 'prefix catch-all')
  ok(/path: ['"]\/:pathMatch\(\.\*\)\*['"]/.test(c), 'top-level catch-all')
  ok(/left: 0,\s*top: 0/.test(c), 'scroll x/y to left/top')
  ok(/router\.isReady\(\)\.then\(/.test(c), 'onReady to isReady().then')
  ok(/router\.currentRoute\.value\.path/.test(c), 'currentRoute to .value')
}

console.log('== router module: default mode is hash; addRoutes; prototype patch ==')
{
  const r = migrateRouterModule(`
    import VueRouter from 'vue-router'
    const originalPush = VueRouter.prototype.push
    VueRouter.prototype.push = function push(location) {
      return originalPush.call(this, location).catch((err) => err)
    }
    const router = new VueRouter({ routes: [] })
    router.addRoutes(extra)
    export function isDup(e) { return VueRouter.isNavigationFailure(e) }
    export default router
  `)
  const c = r.code
  ok(/history: createWebHashHistory\(\)/.test(c), 'no mode to hash history')
  ok(!/prototype/.test(c) && !/originalPush/.test(c), 'prototype patch + helper removed')
  ok(/extra\.forEach\(__v23Route => router\.addRoute\(__v23Route\)\)/.test(c), 'addRoutes to forEach addRoute')
  ok(/isNavigationFailure\(e\)/.test(c) && /isNavigationFailure \}|isNavigationFailure,/.test(c), 'static member to named import')
}

console.log('== router module: dynamic mode to conditional history ==')
{
  const r = migrateRouterModule(`
    import VueRouter from 'vue-router'
    export default new VueRouter({ mode: cfg.mode, routes: [] })
  `)
  ok(/cfg\.mode === ['"]history['"] \? createWebHistory\(\)/.test(r.code), 'dynamic mode conditional')
}

console.log('== script setup: this.$route / this.$router to useRoute / useRouter ==')
{
  const r = migrateRouterScriptSetup(`/* v23:composition */
import { computed } from 'vue'
import { navItems } from '@/router/index'
const pageTitle = computed(() => this.$route.meta && this.$route.meta.title || 'x')
function go() { this.$router.push('/a'); return this.$router.currentRoute.path }
`)
  const c = r.code
  ok(/import \{ useRoute, useRouter \} from ['"]vue-router['"]/.test(c), 'imports added')
  ok(/const route = useRoute\(\);\s*const router = useRouter\(\);/.test(c), 'composables declared')
  ok(c.indexOf('useRoute()') > c.indexOf("from '@/router/index'"), 'declared after imports')
  ok(/route\.meta && route\.meta\.title/.test(c), '$route to route')
  ok(/router\.push\(['"]\/a['"]\)/.test(c) && /router\.currentRoute\.value\.path/.test(c), '$router to router')
  ok(!/this\.\$route/.test(c), 'no leftover this.$route')
}

console.log('== script setup: this.$router only (G010) ==')
{
  const r = migrateRouterScriptSetup(`function go() { this.$router.push('/a') }`)
  ok(/useRouter\(\)/.test(r.code), 'useRouter when only $router')
  ok(/router\.push\(['"]\/a['"]\)/.test(r.code), '$router to router')
  ok(!/this\.\$router/.test(r.code), 'no leftover this.$router')
}

console.log('== script setup: name collision ==')
{
  const r = migrateRouterScriptSetup(`const route = 'x'\nconst t = this.$route.path`)
  ok(/const route_1 = useRoute\(\)/.test(r.code) && /route_1\.path/.test(r.code), 'unique id when route taken')
}

console.log('== Options to composition to $route/$router (common path) ==')
{
  const { migrateOptionsToComposition } = require('../src/transform/options-to-composition')
  const src = `
export default {
  name: 'RtCommon',
  methods: {
    go() { this.$router.push({ name: 'x', params: { id: '1' }, query: { q: 'y' } }) },
    title() { return this.$route.meta && this.$route.meta.title },
  },
}
`
  const opt = migrateOptionsToComposition(src, { filename: 'common.vue' })
  ok(!opt.skipped, 'options converted to setup')
  ok(/this\.\$route/.test(opt.code) && /this\.\$router/.test(opt.code), 'composition left this.$route/$router')
  const r = migrateRouterScriptSetup(opt.code, 'common.vue')
  ok(/useRoute\(\)/.test(r.code) && /useRouter\(\)/.test(r.code), 'router plugin fills useRoute/useRouter')
  ok(!/this\.\$route/.test(r.code) && !/this\.\$router/.test(r.code), 'no leftover this.$route/$router')
  ok(/router\.push\(\{/.test(r.code) && /route\.meta/.test(r.code), 'call sites rewritten')
}

console.log('== scrollBehavior assert helpers (G015) ==')
{
  const r = migrateRouterModule(`
    import VueRouter from 'vue-router'
    const router = new VueRouter({
      mode: 'abstract',
      scrollBehavior(to) {
        if (to.hash) return { selector: to.hash, x: 0, y: 12 }
        return { x: 0, y: 0 }
      },
      routes: [],
    })
    const sample = router.options.scrollBehavior({ hash: '#x' }, {}, null)
    const scrollLog = sample && sample.selector === '#x' && sample.y === 12 ? 'xy-shape' : 'no'
    export default router
  `)
  ok(/el: to\.hash,\s*left: 0,\s*top: 12/.test(r.code) || /left: 0,\s*top: 12,\s*el:/.test(r.code) || /el:/.test(r.code) && /top: 12/.test(r.code), 'scroll fields renamed')
  ok(/sample\.el === ['"]#x['"]/.test(r.code) && /sample\.top === 12/.test(r.code), 'sample.selector/y → el/top')
  ok(/['"]lte-shape['"]/.test(r.code) && !/['"]xy-shape['"]/.test(r.code), 'xy-shape → lte-shape')
}

console.log('== async-component skips route record loaders ==')
{
  const r = migrateAsyncComponent(`
    export const routes = [
      { path: '/a', component: () => import('./A.vue') },
      { path: '/b', components: { default: () => import('./B.vue') } },
    ]
    export const comps = { C: () => import('./C.vue') }
  `)
  ok(/component: \(\) => import\(['"]\.\/A\.vue['"]\)/.test(r.code), 'route component stays plain loader')
  ok(/default: \(\) => import\(['"]\.\/B\.vue['"]\)/.test(r.code), 'named view stays plain loader')
  ok(/C: defineAsyncComponent/.test(r.code), 'non-route factory still wrapped')
}

console.log('== match / getMatchedComponents / probe.currentRoute (G012) ==')
{
  const r = migrateRouterModule(`
    import { createRouter, createMemoryHistory } from 'vue-router'
    const probe = createRouter({ history: createMemoryHistory(), routes: [] })
    const matched = typeof probe.match === 'function' ? probe.match('/home') : null
    const comps = probe.getMatchedComponents()
    console.log(probe.currentRoute.path, probe.value && probe.currentRoute.name)
  `)
  const c = r.code
  ok(/probe\.resolve\(['"]\/home['"]\)/.test(c), 'typeof match ? match : null → resolve')
  ok(!/\.match\s*\(/.test(c), 'no leftover .match(')
  ok(/probe\.currentRoute\.value\.matched/.test(c), 'getMatchedComponents → currentRoute.value.matched')
  ok(/probe\.currentRoute\.value\.path/.test(c), 'probe.currentRoute → .value')
  ok(!/AI-TODO.*getMatchedComponents|AI-TODO.*router\.match/.test(c), 'no AI-TODO for match/getMatched')
}

console.log('== probe.value.currentRoute + match path arg ==')
{
  const r = migrateRouterModule(`
    import { createRouter, createMemoryHistory } from 'vue-router'
    const probe = { value: null }
    probe.value = createRouter({ history: createMemoryHistory(), routes: [] })
    const path = probe.value.currentRoute.path
    const m = probe.value.match('/lazy')
    export default path
  `)
  ok(/probe\.value\.currentRoute\.value\.path/.test(r.code), 'probe.value.currentRoute → .value')
  ok(/probe\.value\.resolve\(['"]\/lazy['"]\)/.test(r.code), 'probe.value.match(path) → resolve')
}

console.log('\nrouter tests passed')

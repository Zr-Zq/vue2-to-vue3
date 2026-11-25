const assert = require('assert')
const { migrateRouterModule, migrateRouterScriptSetup } = require('../src/transform/js-router')
const { migrateAsyncComponent } = require('../src/transform/js-async-component')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok: ' + msg)
}

console.log('== router module: new VueRouter → createRouter ==')
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
  ok(/left: 0,\s*top: 0/.test(c), 'scroll x/y → left/top')
  ok(/router\.isReady\(\)\.then\(/.test(c), 'onReady → isReady().then')
  ok(/router\.currentRoute\.value\.path/.test(c), 'currentRoute → .value')
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
  ok(/history: createWebHashHistory\(\)/.test(c), 'no mode → hash history')
  ok(!/prototype/.test(c) && !/originalPush/.test(c), 'prototype patch + helper removed')
  ok(/extra\.forEach\(__v23Route => router\.addRoute\(__v23Route\)\)/.test(c), 'addRoutes → forEach addRoute')
  ok(/isNavigationFailure\(e\)/.test(c) && /isNavigationFailure \}|isNavigationFailure,/.test(c), 'static member → named import')
}

console.log('== router module: dynamic mode → conditional history ==')
{
  const r = migrateRouterModule(`
    import VueRouter from 'vue-router'
    export default new VueRouter({ mode: cfg.mode, routes: [] })
  `)
  ok(/cfg\.mode === ['"]history['"] \? createWebHistory\(\)/.test(r.code), 'dynamic mode conditional')
}

console.log('== script setup: this.$route / this.$router → useRoute / useRouter ==')
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
  ok(/route\.meta && route\.meta\.title/.test(c), '$route → route')
  ok(/router\.push\(['"]\/a['"]\)/.test(c) && /router\.currentRoute\.value\.path/.test(c), '$router → router')
  ok(!/this\.\$route/.test(c), 'no leftover this.$route')
}

console.log('== script setup: name collision ==')
{
  const r = migrateRouterScriptSetup(`const route = 'x'\nconst t = this.$route.path`)
  ok(/const route_1 = useRoute\(\)/.test(r.code) && /route_1\.path/.test(r.code), 'unique id when route taken')
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

console.log('\nrouter tests passed')

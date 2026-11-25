const assert = require('assert')
const {
  migrateInstanceEvents,
  needsInstanceEventBus,
} = require('../src/transform/js-instance-events')

function ok(cond, msg) {
  assert.ok(cond, msg)
  console.log('  ok:', msg)
}

console.log('== instance events ==')
{
  ok(needsInstanceEventBus("this.$on('a', fn)"), 'detect $on')
  ok(!needsInstanceEventBus("this.$emit('a')"), 'ignore $emit-only')

  const r = migrateInstanceEvents(`
    created() {
      this.$on('self-event', (p) => { this.x = p })
      this.$once('once', fn)
    },
    beforeUnmount() {
      this.$off('self-event')
    },
    methods: {
      go() { this.$emit('self-event', 'ok') }
    }
  `)
  ok(/this\.\$bus\.\$on\(/.test(r.code), '$on → $bus.$on')
  ok(/this\.\$bus\.\$once\(/.test(r.code), '$once → $bus.$once')
  ok(/this\.\$bus\.\$off\(/.test(r.code), '$off → $bus.$off')
  ok(/this\.\$bus\.\$emit\('self-event'/.test(r.code), 'self-listen $emit → $bus.$emit')
}

console.log('== parent $emit kept ==')
{
  const r = migrateInstanceEvents(`methods: { go() { this.$emit('click') } }`)
  ok(/this\.\$emit\('click'\)/.test(r.code), 'unrelated $emit unchanged')
}

console.log('== edge: $on/$off/$once mixed with parent $emit + string/method ref ==')
{
  const r = migrateInstanceEvents(`
    created() {
      this.$on('ping', this.onPing)
      this.$on('ping', (p) => { this.last = p })
      this.$once('once-only', this.onOnce)
    },
    beforeDestroy() {
      this.$off('ping', this.onPing)
      this.$off('ping')
    },
    methods: {
      onPing(p) { this.last = p },
      onOnce() { this.onceHit = true },
      fireBus() { this.$emit('ping', 1) },
      fireParent() { this.$emit('update:title', 'x') }
    }
  `)
  ok(/this\.\$bus\.\$on\('ping',\s*this\.onPing\)/.test(r.code), '$on method ref → $bus')
  ok(/this\.\$bus\.\$on\('ping',\s*\(p\)/.test(r.code), '$on arrow → $bus')
  ok(/this\.\$bus\.\$once\('once-only'/.test(r.code), '$once → $bus')
  ok(/this\.\$bus\.\$off\('ping',\s*this\.onPing\)/.test(r.code), '$off with handler')
  ok(/this\.\$bus\.\$off\('ping'\)/.test(r.code), '$off event-only')
  ok(/this\.\$bus\.\$emit\('ping'/.test(r.code), 'self-listen emit → $bus')
  ok(/this\.\$emit\('update:title'/.test(r.code), 'parent-facing emit unchanged')
}

console.log('== edge: already on $bus stays stable ==')
{
  const src = "created() { this.$bus.$on('a', fn); this.$bus.$emit('a') }"
  const r = migrateInstanceEvents(src)
  ok(/this\.\$bus\.\$on/.test(r.code), '$bus.$on kept')
  ok((r.code.match(/\$bus/g) || []).length >= 2, 'no double-wrap $bus.$bus')
  ok(!/this\.\$bus\.\$bus/.test(r.code), 'no $bus.$bus')
}

console.log('== main bus register: balanced createApp (arrow args) ==')
{
  const { patchMainBusRegister } = require('../src/pipeline/plugins/migrate-instance-events')
  const src = `
import { createApp } from 'vue'
import App from './App.vue'
createApp(() => App).use(router).mount('#app')
`
  const out = patchMainBusRegister(src)
  ok(/from\s+['"]@\/compat\/v23-bus['"]/.test(out), 'imports v23-bus')
  ok(/const __v23App = createApp\(\(\)\s*=>\s*App\)/.test(out), 'createApp arrow arg preserved')
  ok(/__v23App\.config\.globalProperties\.\$bus = __v23Bus/.test(out), 'registers $bus')
  ok(/__v23App\.use\(router\)\.mount\('#app'\)/.test(out), 'chain preserved')
  ok(!/createApp\(\)\s*=>/.test(out), 'did not truncate at first )')
}

console.log('== main bus register: const app = createApp(App) ==')
{
  const { patchMainBusRegister } = require('../src/pipeline/plugins/migrate-instance-events')
  const src = `
import { createApp } from 'vue'
const app = createApp(App).use(router).mount('#app')
`
  const out = patchMainBusRegister(src)
  ok(/const app = createApp\(App\)/.test(out), 'keeps assign var')
  ok(/app\.config\.globalProperties\.\$bus = __v23Bus/.test(out), 'registers on app')
  ok(/app\.use\(router\)\.mount\('#app'\)/.test(out), 'chain after bus')
}

console.log('\ninstance-events tests passed')

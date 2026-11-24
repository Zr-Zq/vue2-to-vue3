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

console.log('\ninstance-events tests passed')

/**
 * Rewrite Vue2 instance event APIs to a project-local $bus:
 *   this.$on / $off / $once  →  this.$bus.$on / $off / $once
 *   this.$emit('evt') for events that were $on/$once'd in the same file → this.$bus.$emit
 *     (self-listen pattern). Other $emit stay as component→parent events.
 */
function migrateInstanceEvents(code) {
  const changes = []
  let out = String(code || '')

  const listened = new Set()
  const listenRe = /\bthis\s*\.\s*\$(?:on|once)\s*\(\s*(['"])([^'"]+)\1/g
  let lm
  while ((lm = listenRe.exec(out))) {
    listened.add(lm[2])
  }

  const re = /\bthis\s*\.\s*\$(on|off|once)\b/g
  out = out.replace(re, (m, name) => {
    changes.push({ kind: 'instance-event', api: '$' + name, from: m })
    return 'this.$bus.$' + name
  })

  if (listened.size) {
    out = out.replace(/\bthis\s*\.\s*\$emit\s*\(\s*(['"])([^'"]+)\1/g, (m, q, ev) => {
      if (!listened.has(ev)) return m
      changes.push({ kind: 'instance-event-emit', api: '$emit', event: ev, from: m })
      return 'this.$bus.$emit(' + q + ev + q
    })
  }

  return { code: out, changes }
}

function needsInstanceEventBus(code) {
  return /\bthis\s*\.\s*\$(on|off|once)\b/.test(String(code || ''))
}

module.exports = {
  migrateInstanceEvents,
  needsInstanceEventBus,
}

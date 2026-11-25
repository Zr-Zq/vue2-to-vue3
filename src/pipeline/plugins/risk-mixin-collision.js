const { createPlugin } = require('../create-plugin')
const { pushRisk } = require('../risk/helpers')

/**
 * Depends on preflight graph.mixins: host vs mixin same-name member collisions.
 * Scan the graph once in setup; match only entry files would duplicate — use setup global scan.
 */
module.exports = createPlugin({
  name: 'risk-mixin-collision',
  description: 'Mixin vs host same-name member collision (needs graph)',
  version: '0.1.0',
  async setup(project) {
    const mixins = project.graph && project.graph.mixins
    if (!mixins || !mixins.memberIndex) return

    // Aggregate by apply-file: members injected by local mixins in that file
    const byHost = Object.create(null)
    mixins.applications.forEach((app) => {
      if (!app.file) return
      if (!byHost[app.file]) byHost[app.file] = []
      byHost[app.file].push(app)
    })

    // Member to multiple mixin sources or clash with same-file options: flag multi-mixin first
    const nameHosts = Object.create(null)
    mixins.memberIndex.forEach((m) => {
      ;(m.appliedBy || []).forEach((a) => {
        const key = a.file + '::' + m.name
        if (!nameHosts[key]) nameHosts[key] = []
        nameHosts[key].push(m)
      })
    })

    Object.keys(nameHosts).forEach((key) => {
      const list = nameHosts[key]
      if (list.length < 2) return
      const file = key.split('::')[0]
      const name = key.split('::')[1]
      pushRisk(project, {
        id: 'mixin.multi-source',
        category: 'mixin-collision',
        level: 'warn',
        auto: 'partial',
        file,
        message: 'member "' + name + '" comes from multiple mixin application paths',
        evidence: list.map((x) => x.mixinFile).join(' | '),
        hint: 'Merge priority follows Vue2 mixin strategy; migrate explicitly',
      })
    })

    // Global mixin members: mark all as block hints
    mixins.memberIndex.forEach((m) => {
      if (!m.global) return
      pushRisk(project, {
        id: 'mixin.global-member',
        category: 'mixin-collision',
        level: 'block',
        auto: 'no',
        file: m.mixinFile,
        message: 'Global mixin injects member "' + m.name + '" (' + m.section + ')',
        evidence: m.mixinFile,
        hint: 'Wide blast radius; confirm replacement manually',
      })
    })
  },
  match() {
    return false // setup-only graph scan
  },
})

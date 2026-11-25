const { createPlugin } = require('../create-plugin')
const {
  pushRisk,
  loadScripts,
  locOf,
  thisMemberChain,
  traverse,
  t,
} = require('../risk/helpers')

/**
 * Options API → Composition API risk detection (JS stream, runs with HTML risks).
 * Safe path is rewritten by migrate-options-composition first; this plugin flags leftovers
 * (watch complexity, $options, tree APIs, unresolved mixins, etc.).
 * risk-annotate inserts AI-TODO for auto!=='yes'.
 */

const OPTION_MAP = {
  data: {
    id: 'composition.data',
    level: 'warn',
    message: 'data() → ref/reactive; template/this bindings become .value or reactive fields',
    hint: 'Prefer reactive for objects; ref for primitives; unwrap carefully in setup return / script setup',
  },
  computed: {
    id: 'composition.computed',
    level: 'warn',
    message: 'computed → computed(); getter/setter must keep this-scope via closure over refs',
    hint: 'Map get/set pairs; avoid reading unset refs before init order is fixed',
  },
  methods: {
    id: 'composition.methods',
    level: 'warn',
    message: 'methods → plain functions in setup; this.xxx becomes local bindings',
    hint: 'Watch closures capturing stale refs; keep event handlers stable when passed as props',
  },
  watch: {
    id: 'composition.watch',
    level: 'warn',
    message: 'watch options → watch()/watchEffect(); string handlers and deep/immediate need remapping',
    hint: 'String handler names become function refs; deep on reactive objects differs from Vue2',
  },
  mixins: {
    id: 'composition.mixins',
    level: 'block',
    message: 'mixins → composable functions; merge order and this injection change',
    hint: 'Extract shared state/lifecycle into useXxx(); resolve name collisions explicitly',
  },
  filters: {
    id: 'composition.filters',
    level: 'warn',
    message: 'filters option has no Composition equivalent; use methods/plain functions',
    hint: 'After HTML |filter→call, keep functions imported or defined in setup',
  },
  provide: {
    id: 'composition.provide',
    level: 'warn',
    message: 'provide → provide(); primitives need ref/reactive for consumers to stay live',
    hint: 'Align with inject() keys (string/Symbol); prefer readonly() when exposing state',
  },
  inject: {
    id: 'composition.inject',
    level: 'warn',
    message: 'inject → inject(); default factory and reactivity differ from Options',
    hint: 'Defaults: inject(key, default) or inject(key, () => default, true)',
  },
  props: {
    id: 'composition.props',
    level: 'info',
    message: 'props → defineProps(); do not destructure without toRefs/toRef if reactivity needed',
    hint: 'emit via defineEmits; declare emits for fallthrough clarity',
  },
  components: {
    id: 'composition.components',
    level: 'info',
    message: 'components map → import in script setup (auto-available) or components: in setup()',
    hint: 'Async components: defineAsyncComponent',
  },
  directives: {
    id: 'composition.directives',
    level: 'warn',
    message: 'directives → directive hooks in script setup (vName) or app.directive',
    hint: 'Hook names already migrate; registration site moves with Composition',
  },
  model: {
    id: 'composition.model',
    level: 'warn',
    message: 'model: { prop, event } → defineModel() / v-model args in Vue3',
    hint: 'Custom v-model prop/event pair must become modelValue or named v-model',
  },
  inheritAttrs: {
    id: 'composition.inheritAttrs',
    level: 'info',
    message: 'inheritAttrs: false stays; pair with useAttrs() when rewriting script',
    hint: 'Attrs fallthrough behavior differs when multi-root',
  },
  render: {
    id: 'composition.render',
    level: 'warn',
    message: 'render(h) with Options this → h import + setup state; or prefer template',
    hint: 'Slots: useSlots(); scoped slot props no longer on this',
  },
  setup: {
    id: 'composition.setup-present',
    level: 'info',
    message: 'Already has setup(); confirm whether to finish move to script setup',
    hint: 'Mixed Options+setup is setup-mix; prefer one style per file when converting',
  },
}

const LIFECYCLE = {
  beforeCreate: {
    id: 'composition.beforeCreate',
    level: 'block',
    message: 'beforeCreate has no setup equivalent; move sync init into setup body carefully',
    hint: 'setup runs like beforeCreate+created combined for sync code; no this yet in Options beforeCreate',
  },
  created: {
    id: 'composition.created',
    level: 'warn',
    message: 'created → sync code at top of setup / onBeforeMount for DOM-free init',
    hint: 'Data from created that Options assumed ready must be initialized before return',
  },
  beforeMount: {
    id: 'composition.beforeMount',
    level: 'info',
    message: 'beforeMount → onBeforeMount',
    hint: '',
  },
  mounted: {
    id: 'composition.mounted',
    level: 'info',
    message: 'mounted → onMounted; $refs only safe inside/after',
    hint: '',
  },
  beforeUpdate: {
    id: 'composition.beforeUpdate',
    level: 'info',
    message: 'beforeUpdate → onBeforeUpdate',
    hint: '',
  },
  updated: {
    id: 'composition.updated',
    level: 'info',
    message: 'updated → onUpdated',
    hint: '',
  },
  activated: {
    id: 'composition.activated',
    level: 'info',
    message: 'activated → onActivated (keep-alive)',
    hint: '',
  },
  deactivated: {
    id: 'composition.deactivated',
    level: 'info',
    message: 'deactivated → onDeactivated (keep-alive)',
    hint: '',
  },
  beforeDestroy: {
    id: 'composition.beforeUnmount',
    level: 'warn',
    message: 'beforeDestroy → onBeforeUnmount (name already rewritten by migrate-api-compat)',
    hint: 'Clear timers/listeners in onBeforeUnmount',
  },
  destroyed: {
    id: 'composition.unmounted',
    level: 'warn',
    message: 'destroyed → onUnmounted',
    hint: '',
  },
  beforeUnmount: {
    id: 'composition.beforeUnmount',
    level: 'info',
    message: 'beforeUnmount → onBeforeUnmount',
    hint: '',
  },
  unmounted: {
    id: 'composition.unmounted',
    level: 'info',
    message: 'unmounted → onUnmounted',
    hint: '',
  },
  errorCaptured: {
    id: 'composition.errorCaptured',
    level: 'warn',
    message: 'errorCaptured → onErrorCaptured',
    hint: '',
  },
}

const SPECIAL_THIS = new Set([
  '$refs',
  '$emit',
  '$nextTick',
  '$watch',
  '$set',
  '$delete',
  '$slots',
  '$scopedSlots',
  '$attrs',
  '$listeners',
  '$options',
  '$parent',
  '$root',
  '$children',
  '$el',
])

function optionKeyName(prop) {
  if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) return null
  if (t.isIdentifier(prop.key) && !prop.computed) return prop.key.name
  if (t.isStringLiteral(prop.key)) return prop.key.value
  return null
}

function resolveOptionsObject(exportDecl) {
  const d = exportDecl.declaration
  if (t.isObjectExpression(d)) return d
  if (
    t.isCallExpression(d) &&
    t.isIdentifier(d.callee, { name: 'defineComponent' }) &&
    t.isObjectExpression(d.arguments[0])
  ) {
    return d.arguments[0]
  }
  if (t.isIdentifier(d)) {
    // handled via binding in visitor
    return { __ident: d.name }
  }
  return null
}

function eachOptionsObject(ast, visit) {
  if (!ast) return
  traverse(ast, {
    ExportDefaultDeclaration(p) {
      const resolved = resolveOptionsObject(p.node)
      if (!resolved) return
      let obj = resolved
      if (resolved.__ident) {
        const b = p.scope.getBinding(resolved.__ident)
        if (b && b.path.isVariableDeclarator() && t.isObjectExpression(b.path.node.init)) {
          obj = b.path.node.init
        } else {
          return
        }
      }
      visit(obj, p)
    },
  })
}

module.exports = createPlugin({
  name: 'risk-options-composition',
  description: 'Detect Options API patterns that need Composition API migration (scope/API)',
  version: '0.1.0',
  match(ctx) {
    return (
      ctx.file.kind === 'vue' ||
      /\.(vue|js|jsx|ts|tsx|mjs|cjs)$/.test(ctx.file.ext || '')
    )
  },
  async transform(ctx, api) {
    const scripts = loadScripts(ctx)
    if (!scripts.length) return

    scripts.forEach((script) => {
      if (script.setup) {
        // <script setup> already Composition; skip Options scan for this block
        return
      }
      // Options intentionally kept (imported mixins / extends): one header AI-TODO is enough;
      // per-option "→ ref/computed" hints would be noise for valid Vue3 Options code.
      if (/AI-TODO:\s*\[options-to-composition\]\s*kept Options API/.test(script.code || '')) {
        return
      }

      let sawOptions = false

      eachOptionsObject(script.ast, (obj) => {
        const keys = []
        obj.properties.forEach((prop) => {
          const key = optionKeyName(prop)
          if (!key) return
          keys.push(key)

          if (OPTION_MAP[key]) {
            sawOptions = true
            const meta = OPTION_MAP[key]
            pushRisk(api.project, {
              id: meta.id,
              category: 'options-to-composition',
              level: meta.level,
              auto: 'no',
              file: ctx.file.path,
              message: meta.message,
              loc: locOf(prop),
              evidence: key,
              hint: meta.hint,
              part: 'js',
            })
          }

          if (LIFECYCLE[key]) {
            sawOptions = true
            const meta = LIFECYCLE[key]
            pushRisk(api.project, {
              id: meta.id,
              category: 'options-to-composition',
              level: meta.level,
              auto: 'no',
              file: ctx.file.path,
              message: meta.message,
              loc: locOf(prop),
              evidence: key,
              hint: meta.hint,
              part: 'js',
            })
          }

          // methods: arrow functions break Options this (edge when converting)
          if (key === 'methods' && t.isObjectExpression(prop.value)) {
            prop.value.properties.forEach((mp) => {
              if (!t.isObjectProperty(mp)) return
              if (t.isArrowFunctionExpression(mp.value)) {
                const name = optionKeyName(mp) || '?'
                pushRisk(api.project, {
                  id: 'composition.arrow-method',
                  category: 'options-to-composition',
                  level: 'warn',
                  auto: 'no',
                  file: ctx.file.path,
                  message:
                    'Arrow method "' +
                    name +
                    '" does not bind Options this; Composition rewrite must use local bindings only',
                  loc: locOf(mp),
                  evidence: 'methods.' + name + '=>',
                  hint: 'In setup, prefer const name = () => {} over relying on this',
                  part: 'js',
                })
              }
            })
          }

          // watch: string handlers
          if (key === 'watch' && t.isObjectExpression(prop.value)) {
            prop.value.properties.forEach((wp) => {
              if (!t.isObjectProperty(wp)) return
              if (t.isStringLiteral(wp.value)) {
                pushRisk(api.project, {
                  id: 'composition.watch-string',
                  category: 'options-to-composition',
                  level: 'warn',
                  auto: 'no',
                  file: ctx.file.path,
                  message:
                    'String watch handler "' +
                    wp.value.value +
                    '" → pass function reference in watch()',
                  loc: locOf(wp),
                  evidence: String(optionKeyName(wp) || '') + ': \'' + wp.value.value + '\'',
                  hint: 'watch(source, handlerFn) — handler must be in scope',
                  part: 'js',
                })
              } else if (
                t.isObjectExpression(wp.value) &&
                wp.value.properties.some(
                  (hp) =>
                    optionKeyName(hp) === 'handler' &&
                    t.isObjectProperty(hp) &&
                    t.isStringLiteral(hp.value)
                )
              ) {
                pushRisk(api.project, {
                  id: 'composition.watch-string',
                  category: 'options-to-composition',
                  level: 'warn',
                  auto: 'no',
                  file: ctx.file.path,
                  message: 'watch.handler string → function reference in Composition watch()',
                  loc: locOf(wp),
                  evidence: optionKeyName(wp) || 'watch',
                  hint: 'Inline handler or const fn in setup',
                  part: 'js',
                })
              }
            })
          }
        })

        if (keys.length && !sawOptions) {
          // bare export default { name } etc. — ignore
        }
      })

      // this.$refs / $options / $emit scope notes inside Options script
      traverse(script.ast, {
        MemberExpression(p) {
          const chain = thisMemberChain(p.node)
          if (!chain || !chain.length) return
          const head = chain[0]
          if (!SPECIAL_THIS.has(head)) return
          // $parent/$root/$children already covered by risk-instance-api; still flag composition mapping
          const compositionHint = {
            $refs: 'this.$refs.x → const x = ref(null) + template ref="x"',
            $emit: 'this.$emit → const emit = defineEmits([...]); emit(...)',
            $nextTick: 'this.$nextTick → import { nextTick } from "vue"',
            $watch: 'this.$watch → watch()',
            $set: 'this.$set → direct assignment (Vue3) / reactive',
            $delete: 'this.$delete → delete obj.key',
            $slots: 'this.$slots → useSlots()',
            $scopedSlots: 'this.$scopedSlots → useSlots() (Vue3)',
            $attrs: 'this.$attrs → useAttrs()',
            $listeners: 'this.$listeners merged into attrs in Vue3 → useAttrs()',
            $options: 'this.$options has no full Composition equivalent; redesign',
            $parent: 'this.$parent → provide/inject or explicit props/emits',
            $root: 'this.$root → app-level provide or pinia/store',
            $children: 'this.$children removed → template refs / provide',
            $el: 'this.$el → root element ref',
          }
          pushRisk(api.project, {
            id: 'composition.this.' + head,
            category: 'options-to-composition',
            level: head === '$options' || head === '$parent' || head === '$root' ? 'block' : 'warn',
            auto: 'no',
            file: ctx.file.path,
            message: 'Options this.' + chain.join('.') + ' needs Composition remapping',
            loc: locOf(p.node),
            evidence: 'this.' + chain.join('.'),
            hint: compositionHint[head] || 'Replace Options instance API with Composition equivalents',
            part: 'js',
          })
          p.skip()
        },
      })
    })
  },
})

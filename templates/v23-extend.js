/**
 * Vue2 Vue.extend / Sub.extend constructor, for Vue3.
 * Copied to src/compat/v23-extend.js when migrate-extend rewrites a file.
 *
 * __v23Extend stays a function, so `typeof Ctor === 'function'` and a dynamic
 * `new variable()` keep the Vue2 meaning. Direct call sites are rewritten to
 * __v23New, which also accepts a plain component object.
 */
import { createApp, defineComponent, h } from 'vue'

export function __v23New(Ctor, extra) {
  if (typeof Ctor === 'function') return new Ctor(extra)
  const opts = extra && typeof extra === 'object' ? extra : {}
  const props = opts.propsData
  let el = opts.el
  if (typeof el === 'string' && typeof document !== 'undefined') el = document.querySelector(el)
  if (!el && typeof document !== 'undefined') el = document.createElement('div')
  const app = createApp(Ctor, props)
  const inst = app.mount(el)
  if (inst && typeof inst === 'object' && typeof inst.$destroy !== 'function') {
    inst.$destroy = function v23Destroy() {
      app.unmount()
    }
  }
  return inst
}

export function __v23Extend(options) {
  const normalized = normalizeExtends(options)
  const comp = defineComponent(normalized)

  function Ctor(arg, ctx) {
    if (!new.target) {
      return h(comp, arg, ctx && ctx.slots)
    }
    return __v23New(comp, arg)
  }

  Ctor.__v23Comp = comp
  Ctor.__v23Options = normalized
  Ctor.extend = function v23Extend(extra) {
    const more = extra && typeof extra === 'object' ? extra : {}
    return __v23Extend(Object.assign({ extends: Ctor }, more))
  }
  return Ctor
}

function normalizeExtends(options) {
  if (!options || typeof options !== 'object' || !options.extends) return options
  const base = options.extends
  const comp = base && (base.__v23Comp || null)
  if (!comp) return options
  return Object.assign({}, options, { extends: comp })
}

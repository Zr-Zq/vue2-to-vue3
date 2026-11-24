/**
 * Vue3 replacement for Vue2 instance event bus ($on / $off / $once).
 * Copied into the migrate target by migrate-instance-events when needed.
 *
 * Usage after install:
 *   import { bus } from '@/compat/v23-bus'
 *   // or this.$bus after main.js registers app.config.globalProperties.$bus
 */
function createBus() {
  const map = Object.create(null)

  function on(event, fn) {
    ;(map[event] || (map[event] = [])).push(fn)
    return api
  }

  function once(event, fn) {
    const wrap = function wrapped() {
      off(event, wrap)
      fn.apply(null, arguments)
    }
    wrap.fn = fn
    return on(event, wrap)
  }

  function off(event, fn) {
    if (!arguments.length) {
      Object.keys(map).forEach((k) => {
        delete map[k]
      })
      return api
    }
    const list = map[event]
    if (!list) return api
    if (!fn) {
      map[event] = []
      return api
    }
    map[event] = list.filter((cb) => cb !== fn && cb.fn !== fn)
    return api
  }

  function emit(event) {
    const list = (map[event] || []).slice()
    const args = Array.prototype.slice.call(arguments, 1)
    list.forEach((fn) => fn.apply(null, args))
    return api
  }

  const api = {
    $on: on,
    $once: once,
    $off: off,
    $emit: emit,
    on,
    once,
    off,
    emit,
  }
  return api
}

export const bus = createBus()
export default bus

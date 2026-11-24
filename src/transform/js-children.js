/**
 * this.$children → __v23Children(this)
 * 注入 Vue3 近似实现（走 subTree 收集子组件 proxy）。
 * 无完美对等 API；脚本可改，但调用方语义需回归。
 */

const HELPER_NAME = '__v23Children'
const HELPER = `
function ${HELPER_NAME}(vm) {
  const out = []
  try {
    const walk = (vnode) => {
      if (!vnode) return
      if (vnode.component) {
        const inst = vnode.component.proxy || vnode.component.ctx
        if (inst) out.push(inst)
      }
      const ch = vnode.children
      if (Array.isArray(ch)) ch.forEach(walk)
      else if (ch && typeof ch === 'object') {
        Object.keys(ch).forEach((k) => {
          const slot = ch[k]
          if (typeof slot === 'function') {
            try { ;(slot() || []).forEach(walk) } catch (e) { /* ignore */ }
          } else if (Array.isArray(slot)) slot.forEach(walk)
        })
      }
    }
    const root = vm && vm.$ && vm.$.subTree
    walk(root)
  } catch (e) { /* ignore */ }
  return out
}
`.trim()

function migrateChildren(code) {
  const src = String(code || '')
  if (!/\$children\b/.test(src)) return { code: src, changes: [] }

  const changes = []
  let out = src.replace(/this\.\$children\b/g, (m) => {
    changes.push({ kind: 'children-to-helper', from: m, to: HELPER_NAME + '(this)' })
    return HELPER_NAME + '(this)'
  })

  // 也处理 vm.$children / xxx.$children（标识. $children）
  out = out.replace(/([A-Za-z_$][\w$]*)\.\$children\b/g, (m, id) => {
    if (id === 'this') return m // 已处理
    changes.push({ kind: 'children-to-helper', from: m, to: HELPER_NAME + '(' + id + ')' })
    return HELPER_NAME + '(' + id + ')'
  })

  if (!changes.length) return { code: src, changes: [] }

  if (!new RegExp('function\\s+' + HELPER_NAME + '\\b').test(out) && out.indexOf(HELPER) === -1) {
    // 插到 script 内容顶部（import 之后）
    const lines = out.split(/\r?\n/)
    let insertAt = 0
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*import\s/.test(lines[i])) insertAt = i + 1
      else if (insertAt > 0 && !/^\s*import\s/.test(lines[i]) && lines[i].trim() !== '') break
    }
    lines.splice(insertAt, 0, HELPER, '')
    out = lines.join('\n')
    changes.push({ kind: 'inject-children-helper' })
  }

  return { code: out, changes }
}

module.exports = {
  migrateChildren,
  HELPER_NAME,
  HELPER,
}

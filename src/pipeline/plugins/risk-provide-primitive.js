const { createPlugin } = require('../create-plugin')
const { pushRisk, loadScripts, locOf, traverse, t } = require('../risk/helpers')

function isPrimitiveNode(node) {
  return (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument))
  )
}

function scanProvideObject(obj, file, project, loc) {
  if (!t.isObjectExpression(obj)) return
  obj.properties.forEach((prop) => {
    if (!t.isObjectProperty(prop)) return
    const key = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : '?'
    if (isPrimitiveNode(prop.value)) {
      pushRisk(project, {
        id: 'provide.primitive',
        category: 'provide-primitive',
        level: 'warn',
        auto: 'partial',
        file,
        message: 'provide primitive key "' + key + '" (not reactive in Vue2)',
        loc: locOf(prop) || loc,
        evidence: key,
        hint:
          'OptionstoComposition wraps primitives in ref(); inject side must use Ref (.value). Sample inject call sites and confirm (auto=partial).',
      })
    }
  })
}

module.exports = createPlugin({
  name: 'risk-provide-primitive',
  description: 'Detect provide of literal primitives',
  version: '0.1.0',
  match(ctx) {
    return /provide\s*[:(]/.test(ctx.file.content)
  },
  async transform(ctx, api) {
    loadScripts(ctx).forEach((script) => {
      traverse(script.ast, {
        ObjectProperty(p) {
          if (!t.isIdentifier(p.node.key, { name: 'provide' }) && !(t.isStringLiteral(p.node.key) && p.node.key.value === 'provide')) {
            return
          }
          const val = p.node.value
          if (t.isObjectExpression(val)) {
            scanProvideObject(val, ctx.file.path, api.project, locOf(p.node))
          } else if (t.isFunctionExpression(val) || t.isArrowFunctionExpression(val)) {
            // provide() { return { n: 1 } }
            const body = val.body
            if (t.isObjectExpression(body)) {
              scanProvideObject(body, ctx.file.path, api.project, locOf(p.node))
            } else if (body && body.body) {
              body.body.forEach((stmt) => {
                if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                  scanProvideObject(stmt.argument, ctx.file.path, api.project, locOf(stmt))
                }
              })
            }
          }
        },
        ObjectMethod(p) {
          if (!t.isIdentifier(p.node.key, { name: 'provide' })) return
          ;(p.node.body.body || []).forEach((stmt) => {
            if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
              scanProvideObject(stmt.argument, ctx.file.path, api.project, locOf(stmt))
            }
          })
        },
      })
    })
  },
})

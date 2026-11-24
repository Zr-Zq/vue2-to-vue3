const traverse = require('@babel/traverse').default
const t = require('@babel/types')
const { resolveImport } = require('./resolve')

function locOf(node) {
  if (!node || !node.loc || !node.loc.start) return null
  return { line: node.loc.start.line, column: node.loc.start.column }
}

function collectSpecifiers(node) {
  const specs = []
  if (!node) return specs
  if (t.isImportDeclaration(node)) {
    node.specifiers.forEach((s) => {
      if (t.isImportDefaultSpecifier(s)) {
        specs.push({ imported: 'default', local: s.local.name, kind: 'default' })
      } else if (t.isImportNamespaceSpecifier(s)) {
        specs.push({ imported: '*', local: s.local.name, kind: 'namespace' })
      } else if (t.isImportSpecifier(s)) {
        specs.push({
          imported: t.isIdentifier(s.imported) ? s.imported.name : String(s.imported.value),
          local: s.local.name,
          kind: 'named',
        })
      }
    })
  }
  return specs
}

/**
 * Collect import / require / export / dynamic import from AST
 */
function analyzeImportsExports(ast, fromFile, config) {
  const imports = []
  const exports = []
  const dynamics = []

  if (!ast) return { imports, exports, dynamics }

  traverse(ast, {
    ImportDeclaration(p) {
      const source = p.node.source.value
      const resolved = resolveImport(source, fromFile, config)
      imports.push({
        type: 'import',
        source,
        resolved: resolved.resolved,
        external: resolved.external,
        externalKind: resolved.kind,
        specifiers: collectSpecifiers(p.node),
        sideEffect: p.node.specifiers.length === 0,
        loc: locOf(p.node),
      })
    },

    CallExpression(p) {
      const callee = p.node.callee
      // require('x')
      if (t.isIdentifier(callee, { name: 'require' }) && p.node.arguments.length) {
        const arg = p.node.arguments[0]
        if (t.isStringLiteral(arg)) {
          const resolved = resolveImport(arg.value, fromFile, config)
          imports.push({
            type: 'require',
            source: arg.value,
            resolved: resolved.resolved,
            external: resolved.external,
            externalKind: resolved.kind,
            specifiers: [],
            sideEffect: false,
            loc: locOf(p.node),
          })
        } else if (t.isArrayExpression(arg)) {
          // require(['./a', './b'], cb) or require([`./${x}`])
          arg.elements.forEach((el) => {
            if (!el) return
            if (t.isStringLiteral(el)) {
              const resolved = resolveImport(el.value, fromFile, config)
              dynamics.push({
                type: 'require-array',
                source: el.value,
                resolved: resolved.resolved,
                external: resolved.external,
                loc: locOf(p.node),
              })
            } else if (t.isTemplateLiteral(el) && el.quasis.length) {
              dynamics.push({
                type: 'require-array-template',
                source: el.quasis.map((q) => q.value.cooked).join('${…}'),
                resolved: null,
                external: true,
                dynamic: true,
                loc: locOf(p.node),
              })
            }
          })
        }
      }

      // require.context(...)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'require' }) &&
        t.isIdentifier(callee.property, { name: 'context' })
      ) {
        const dirArg = p.node.arguments[0]
        dynamics.push({
          type: 'require.context',
          source: t.isStringLiteral(dirArg) ? dirArg.value : '(dynamic)',
          resolved: null,
          external: false,
          dynamic: true,
          loc: locOf(p.node),
        })
      }

      // import()
      if (callee.type === 'Import') {
        const arg = p.node.arguments[0]
        if (t.isStringLiteral(arg)) {
          const resolved = resolveImport(arg.value, fromFile, config)
          dynamics.push({
            type: 'import()',
            source: arg.value,
            resolved: resolved.resolved,
            external: resolved.external,
            loc: locOf(p.node),
          })
        } else {
          dynamics.push({
            type: 'import()',
            source: '(dynamic)',
            resolved: null,
            external: true,
            dynamic: true,
            loc: locOf(p.node),
          })
        }
      }
    },

    ExportNamedDeclaration(p) {
      const node = p.node
      if (node.source) {
        const resolved = resolveImport(node.source.value, fromFile, config)
        const reExports = (node.specifiers || []).map((s) => ({
          exported: t.isIdentifier(s.exported) ? s.exported.name : String(s.exported.value),
          local: t.isIdentifier(s.local) ? s.local.name : '*',
        }))
        exports.push({
          type: 're-export',
          source: node.source.value,
          resolved: resolved.resolved,
          external: resolved.external,
          names: reExports,
          loc: locOf(node),
        })
        imports.push({
          type: 're-export-import',
          source: node.source.value,
          resolved: resolved.resolved,
          external: resolved.external,
          externalKind: resolved.kind,
          specifiers: reExports.map((r) => ({
            imported: r.local,
            local: r.exported,
            kind: 're-export',
          })),
          sideEffect: false,
          loc: locOf(node),
        })
      } else if (node.declaration) {
        const names = []
        if (t.isFunctionDeclaration(node.declaration) || t.isClassDeclaration(node.declaration)) {
          if (node.declaration.id) names.push(node.declaration.id.name)
        } else if (t.isVariableDeclaration(node.declaration)) {
          node.declaration.declarations.forEach((d) => {
            if (t.isIdentifier(d.id)) names.push(d.id.name)
          })
        }
        exports.push({ type: 'named', names, loc: locOf(node) })
      } else {
        const names = (node.specifiers || []).map((s) =>
          t.isIdentifier(s.exported) ? s.exported.name : String(s.exported.value)
        )
        exports.push({ type: 'named', names, loc: locOf(node) })
      }
    },

    ExportDefaultDeclaration(p) {
      exports.push({ type: 'default', names: ['default'], loc: locOf(p.node) })
    },

    ExportAllDeclaration(p) {
      const source = p.node.source.value
      const resolved = resolveImport(source, fromFile, config)
      exports.push({
        type: 'export-all',
        source,
        resolved: resolved.resolved,
        external: resolved.external,
        names: ['*'],
        loc: locOf(p.node),
      })
      imports.push({
        type: 'export-all-import',
        source,
        resolved: resolved.resolved,
        external: resolved.external,
        externalKind: resolved.kind,
        specifiers: [{ imported: '*', local: '*', kind: 'export-all' }],
        sideEffect: false,
        loc: locOf(p.node),
      })
    },
  })

  return { imports, exports, dynamics }
}

module.exports = {
  analyzeImportsExports,
}

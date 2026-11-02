import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import ts from 'typescript'

export function findTests(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = join(root, entry.name)
      return entry.isDirectory() ? findTests(file) : entry.name.endsWith('.test.ts') ? [file] : []
    })
    .sort()
}
function runtimeSpecifiers(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers = new Set()
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text)
  }
  const onlyTypes = (bindings) =>
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((e) => e.isTypeOnly)
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (!clause || (!clause.isTypeOnly && (clause.name || !onlyTypes(clause.namedBindings))))
        add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      if (
        !node.isTypeOnly &&
        !(
          node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly)
        )
      )
        add(node.moduleSpecifier)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}
function localModule(file, specifier) {
  if (!specifier.startsWith('.')) return null
  const full = resolve(dirname(file), specifier)
  const candidates = /\.js$/.test(full)
    ? [full.slice(0, -3) + '.ts', full]
    : [full, full + '.ts', join(full, 'index.ts')]
  const found = candidates.find(
    (candidate) =>
      existsSync(candidate) && ['.ts', '.js', '.mjs', '.cjs'].includes(extname(candidate)),
  )
  if (!found) throw new Error('Cannot resolve runtime dependency ' + specifier + ' from ' + file)
  return found
}
// Runtime imports are traversed transitively; comments and type-only imports do not
// turn pure tests into integration tests. Build a new classifier for each discovery run.
export function createTestClassifier(sourceRoot) {
  const boundaries = new Set(
    ['app.ts', 'db/client.ts', 'config/env.ts'].map((p) => resolve(sourceRoot, p)),
  )
  const edges = new Map()
  return (file) => {
    const seen = new Set()
    function needsEnvironment(current) {
      current = resolve(current)
      if (boundaries.has(current)) return true
      if (seen.has(current)) return false
      seen.add(current)
      if (!edges.has(current))
        edges.set(
          current,
          [...runtimeSpecifiers(current)]
            .map((specifier) => localModule(current, specifier))
            .filter(Boolean),
        )
      return edges.get(current).some(needsEnvironment)
    }
    return needsEnvironment(file) ? 'integration' : 'unit'
  }
}

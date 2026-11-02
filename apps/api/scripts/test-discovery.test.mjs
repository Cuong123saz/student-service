import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { createTestClassifier, findTests } from './test-discovery.mjs'
function fixture(t, sources) {
  const root = mkdtempSync(join(tmpdir(), 'test discovery with spaces-'))
  assert.equal(dirname(root), resolve(tmpdir()))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, contents] of Object.entries(sources)) {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  return { root, classify: createTestClassifier(root) }
}
test('comments, identifiers and all forms of type-only imports stay unit tests', (t) => {
  const { root, classify } = fixture(t, {
    'pure.test.ts': `// buildApp and db/client are documentation, not dependencies.
      import type { One } from './db/client.js'
      import { type Two } from './db/client.js'
      export type { Three } from './config/env.js'
      export { type Four } from './config/env.js'
      type Five = import('./db/client.js').Five
      const buildApp = 'a local stub'`,
  })
  assert.equal(classify(join(root, 'pure.test.ts')), 'unit')
})
test('runtime dependency through a helper is classified as integration', (t) => {
  const { root, classify } = fixture(t, {
    'nested/db.test.ts': `import { helper } from '../helper.js'`,
    'helper.ts': `export { client } from './db/client.js'`,
    'db/client.ts': '',
  })
  assert.equal(classify(join(root, 'nested/db.test.ts')), 'integration')
})
test('side-effect, mixed and dynamic imports require the test environment', (t) => {
  const { root, classify } = fixture(t, {
    'side.test.ts': `import './config/env.js'`,
    'mixed.test.ts': `import { type Row, client } from './db/client.js'`,
    'dynamic.test.ts': `const app = await import('./app.js')`,
    'common.test.ts': `const app = require('./app.js')`,
    'empty.test.ts': `import {} from './config/env.js'`,
    'app.ts': '',
    'db/client.ts': '',
    'config/env.ts': '',
  })
  for (const file of findTests(root)) assert.equal(classify(file), 'integration')
})
test('cycles terminate without hiding environment dependencies', (t) => {
  const { root, classify } = fixture(t, {
    'cycle.test.ts': `import './one.js'`,
    'one.ts': `import './two.js'`,
    'two.ts': `import './one.js'; import './db/client.js'`,
    'db/client.ts': '',
    'pure.test.ts': `import './pure-one.js'`,
    'pure-one.ts': `import './pure-two.js'`,
    'pure-two.ts': `import './pure-one.js'`,
  })
  assert.equal(classify(join(root, 'cycle.test.ts')), 'integration')
  assert.equal(classify(join(root, 'pure.test.ts')), 'unit')
})
test('test inventory is recursive, deterministic, complete and disjoint', (t) => {
  const { root, classify } = fixture(t, {
    'nested/pure.test.ts': `import './helper.js'`,
    'nested/helper.ts': '',
    'other/db.test.ts': `import '../db/client.js'`,
    'db/client.ts': '',
    'not-a-test.ts': '',
  })
  const all = findTests(root)
  const unit = all.filter((f) => classify(f) === 'unit')
  const integration = all.filter((f) => classify(f) === 'integration')
  assert.equal(all.length, 2)
  assert.equal(unit.length, 1)
  assert.equal(integration.length, 1)
  assert.equal(new Set([...unit, ...integration]).size, all.length)
})
test('unresolved runtime imports fail discovery instead of silently skipping coverage', (t) => {
  const { root, classify } = fixture(t, { 'missing.test.ts': `import './missing.js'` })
  assert.throws(() => classify(join(root, 'missing.test.ts')), /Cannot resolve runtime dependency/)
})

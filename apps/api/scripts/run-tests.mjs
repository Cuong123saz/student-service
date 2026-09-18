import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(apiRoot, 'src')

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
    } else if (entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

const mode = process.argv[2]

if (mode !== 'unit' && mode !== 'integration') {
  console.error('Usage: run-tests.mjs <unit|integration>')
  process.exit(1)
}

// A test needs a live database and .env.test only if it builds the real
// Fastify app (buildApp -> route tests) or talks to the Drizzle client
// directly (repository/schema tests). Everything else is a pure unit
// test that can run without either. Verified against the previous
// hand-maintained file lists with zero mismatches before this script
// replaced them.
const needsDbPattern = /buildApp|from ['"][^'"]*db\/client/

const files = walk(srcDir)
  .filter((file) => needsDbPattern.test(readFileSync(file, 'utf8')) === (mode === 'integration'))
  .sort()
  .map((file) => join('src', file.slice(srcDir.length + 1)))

if (files.length === 0) {
  console.error(`No ${mode} test files found under src/`)
  process.exit(1)
}

const args =
  mode === 'integration'
    ? ['--env-file=.env.test', '--test', '--test-concurrency=1', ...files]
    : ['--test', ...files]

// npm prepends node_modules/.bin to PATH for any script it runs, so
// this resolves the local tsx whether invoked via `npm run test:unit`
// or `npm run test:integration`. shell: true is required on Windows
// to execute the .cmd shim; args are our own generated file paths
// (no spaces, no shell metacharacters), so unescaped concatenation
// is not a risk here.
const child = spawn('tsx', args, {
  stdio: 'inherit',
  shell: true,
  cwd: apiRoot,
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})

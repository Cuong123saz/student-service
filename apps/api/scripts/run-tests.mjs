import { spawn } from 'node:child_process'
import { join, relative } from 'node:path'
import { createTestClassifier, findTests } from './test-discovery.mjs'
import { fileURLToPath } from 'node:url'

const apiRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(apiRoot, 'src')

const mode = process.argv[2]

if (mode !== 'unit' && mode !== 'integration') {
  console.error('Usage: run-tests.mjs <unit|integration>')
  process.exit(1)
}

const classify = createTestClassifier(srcDir)
const files = findTests(srcDir)
  .filter((file) => classify(file) === mode)
  .map((file) => relative(apiRoot, file))

if (files.length === 0) {
  console.error(`No ${mode} test files found under src/`)
  process.exit(1)
}

// Windows supervisor fixtures compile and launch owned processes. Serial files avoid
// starving their bounded startup windows when node:test defaults to CPU-count parallelism.
const args =
  mode === 'integration'
    ? ['--env-file=.env.test', '--test', '--test-concurrency=1', ...files]
    : ['--test', ...(process.platform === 'win32' ? ['--test-concurrency=1'] : []), ...files]

// Invoke the active Node runtime directly. No shell, PATH shim, or command-string
// interpolation: checkout paths and test filenames may safely contain spaces.
const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
  stdio: 'inherit',
  cwd: apiRoot,
})
child.on('error', (error) => {
  console.error('Cannot start API tests:', error.message)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})

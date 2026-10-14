import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DocumentProcessReport } from './submission-document-supervisor.js'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { LocalDocumentProvenance } from './submission-document-provenance.js'
async function fixture(t: TestContext) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-document-build-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-document-build-')))
    await rm(root, { recursive: true, force: true })
  })
  const code = join(root, 'code'),
    dependency = join(root, 'dependency'),
    metadata = join(root, 'package-lock.json')
  await mkdir(code)
  await mkdir(dependency)
  await writeFile(join(code, 'renderer.js'), 'export const version = 1')
  await writeFile(join(dependency, 'library.cjs'), 'module.exports = 1')
  await writeFile(metadata, '{"fake":true}')
  const options = {
    codeRoots: [code, dependency],
    metadataFiles: [metadata],
    converterCommand: join(root, 'missing-converter'),
    converterBinary: join(root, 'missing-binary'),
  }
  return { root, code, dependency, metadata, options }
}
test('build provenance hashes actual code, installed rendering dependencies and lockfile with current Node/ICU', async (t) => {
  const f = await fixture(t),
    provenance = await LocalDocumentProvenance.create(f.options),
    report = await provenance.renderer()
  assert.match(report.buildSha256, /^[a-f0-9]{64}$/)
  assert.equal(report.nodeVersion, process.versions.node)
  assert.equal(report.icuVersion, process.versions.icu)
  assert.deepEqual(await provenance.renderer(), report)
  // Converter unavailability cannot prevent Word provenance.
  await assert.rejects(provenance.converter())
  assert.deepEqual(await provenance.renderer(), report)
})
test('mutating code, dependencies or metadata after initialization fails closed', async (t) => {
  const f = await fixture(t)
  for (const path of [join(f.code, 'renderer.js'), join(f.dependency, 'library.cjs'), f.metadata]) {
    const provenance = await LocalDocumentProvenance.create(f.options)
    await writeFile(path, 'changed ' + path)
    await assert.rejects(provenance.renderer(), /DOCUMENT_DEPLOYMENT_CHANGED/)
  }
})
test('adding a compiled module changes the build; sourcemaps are excluded', async (t) => {
  const f = await fixture(t),
    provenance = await LocalDocumentProvenance.create(f.options)
  await writeFile(join(f.code, 'renderer.js.map'), 'debug only')
  await provenance.renderer()
  await writeFile(join(f.code, 'additional.js'), 'export const other = 1')
  await assert.rejects(provenance.renderer(), /DOCUMENT_DEPLOYMENT_CHANGED/)
  await assert.rejects(provenance.converter(), /DOCUMENT_DEPLOYMENT_CHANGED/)
})
test('build collector rejects directory junctions and relative or empty configuration', async (t) => {
  const f = await fixture(t),
    link = join(f.root, 'linked')
  await symlink(f.dependency, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    LocalDocumentProvenance.create({ ...f.options, codeRoots: [link] }),
    /UNSAFE_DOCUMENT_DIRECTORY/,
  )
  await assert.rejects(
    LocalDocumentProvenance.create({ ...f.options, codeRoots: [] }),
    /INVALID_DOCUMENT_PROVENANCE_CONFIG/,
  )
  await assert.rejects(
    LocalDocumentProvenance.create({ ...f.options, metadataFiles: ['relative.json'] }),
    /INVALID_DOCUMENT_PROVENANCE_CONFIG/,
  )
})

test('build provenance includes the deployed Windows supervisor script', async (t) => {
  const f = await fixture(t),
    script = join(f.code, 'windows-document-supervisor.ps1')
  await writeFile(script, '# synthetic supervisor v1')
  const provenance = await LocalDocumentProvenance.create(f.options)
  await provenance.renderer()
  await writeFile(script, '# synthetic supervisor changed')
  await assert.rejects(provenance.renderer(), /DOCUMENT_DEPLOYMENT_CHANGED/)
  await assert.rejects(provenance.converter(), /DOCUMENT_DEPLOYMENT_CHANGED/)
})

test(
  'Windows version reader accepts an eleven-second response and confirms process reaping',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = await fixture(t),
      executable = join(f.root, 'slow-version.exe')
    const code =
      'using System; using System.Threading; public static class SlowVersion { public static void Main() { Thread.Sleep(11000); Console.WriteLine("LibreOffice 0.0.0 synthetic"); } }'
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
    await promisify(execFile)(
      join(
        process.env.SystemRoot || 'C:/Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -TypeDefinition ' +
          quote(code) +
          ' -OutputAssembly ' +
          quote(executable) +
          ' -OutputType ConsoleApplication',
      ],
      { windowsHide: true, timeout: 15000 },
    )
    let report: DocumentProcessReport | undefined
    const provenance = await LocalDocumentProvenance.create(
      { ...f.options, converterCommand: executable, converterBinary: executable },
      {
        finished: (value) => {
          report = value
        },
      },
    )
    const result = await provenance.converter().finally(() => {
      t.diagnostic(JSON.stringify({ event: 'SLOW_VERSION_PROCESS_REPORT', ...report }))
    })
    assert.equal(result.version, 'LibreOffice 0.0.0 synthetic')
    assert.equal(report?.outcome, 'EXITED')
    assert.equal(report?.empty, true)
    assert.equal(report?.watchdogExpired, false)
    assert.ok((report?.elapsedMs || 0) >= 11000)
  },
)

import { LibreOfficePdfConverter } from '../submissions/submission-document.js'
import { SubmissionError } from '../submissions/submission.types.js'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import {
  bootstrapMockConverterProfile,
  loadMockConverterProfile,
} from './mock-converter-profile.js'
async function fixture(t: TestContext) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-mock-profile-')),
    binary = join(root, 'soffice.bin')
  await writeFile(binary, 'synthetic binary')
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-mock-profile-')))
    await rm(root, { recursive: true, force: true })
  })
  return { root, binary, bootstrap: join(root, 'bootstrap') }
}
const pdf = Buffer.from('%PDF-1.7\n' + 'x'.repeat(150) + '\n%%EOF')
async function ready(root: string, args: string[]) {
  await mkdir(join(root, 'profile/user'), { recursive: true })
  await writeFile(join(root, 'profile/user/settings.xcu'), 'synthetic settings')
  await writeFile(join(root, 'profile/user/empty.cache'), '')
  await writeFile(join(root, 'profile/user/dict%2Fhelp.xhp'), 'encoded name is literal')
  await writeFile(join(root, 'profile/.lock'), 'transient lock')
  await writeFile(join(root, 'input.pdf'), pdf)
  assert.ok(args.includes('--convert-to'))
  return { outcome: 'EXITED', empty: true }
}
test('prepared fake profile pins binary/files, omits lock and copies independently to two fresh targets', async (t) => {
  const f = await fixture(t),
    result = await bootstrapMockConverterProfile(
      f.bootstrap,
      Buffer.from('fake'),
      f.binary,
      (args) => ready(f.bootstrap, args),
      { fakeDataOnly: true },
    )
  assert.equal(result.attempts, 1)
  assert.equal(result.files, 3)
  const prepare = await loadMockConverterProfile(result.profileRoot, result.manifestPath, f.binary)
  for (const name of ['job1', 'job2']) {
    await prepare(join(f.root, name))
    assert.equal(
      await readFile(join(f.root, name, 'user/settings.xcu'), 'utf8'),
      'synthetic settings',
    )
    await assert.rejects(access(join(f.root, name, '.lock')))
    assert.equal(
      await readFile(join(f.root, name, 'user/dict%2Fhelp.xhp'), 'utf8'),
      'encoded name is literal',
    )
    await assert.rejects(access(join(f.root, name, 'user/dict/help.xhp')))
  }
  await writeFile(join(f.root, 'job1/user/settings.xcu'), 'job1 changed')
  assert.equal(await readFile(join(f.root, 'job2/user/settings.xcu'), 'utf8'), 'synthetic settings')
  await assert.rejects(prepare(join(f.root, 'job2')), /EEXIST/)
})
test('bootstrap retries at most once and only after a timeout with a reaped process tree', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const result = await bootstrapMockConverterProfile(
    f.bootstrap,
    Buffer.from('fake'),
    f.binary,
    (args) =>
      ++calls === 1
        ? Promise.resolve({ outcome: 'TIMEOUT', empty: true })
        : ready(f.bootstrap, args),
    { fakeDataOnly: true },
  )
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
})
for (const [outcome, empty] of [
  ['TIMEOUT', false],
  ['FAILED', true],
  ['TIMEOUT', true],
] as const)
  test('bootstrap refuses ' + outcome + '/' + empty + ' without unbounded retry', async (t) => {
    const f = await fixture(t)
    let calls = 0
    await assert.rejects(
      bootstrapMockConverterProfile(
        f.bootstrap,
        Buffer.from('fake'),
        f.binary,
        async () => {
          calls++
          return { outcome, empty }
        },
        { fakeDataOnly: true },
      ),
    )
    assert.equal(calls, outcome === 'TIMEOUT' && empty ? 2 : 1)
  })
test('binary, manifest and selected file mutation fail before a copy can be accepted', async (t) => {
  const f = await fixture(t),
    r = await bootstrapMockConverterProfile(
      f.bootstrap,
      Buffer.from('fake'),
      f.binary,
      (args) => ready(f.bootstrap, args),
      { fakeDataOnly: true },
    )
  const prepare = await loadMockConverterProfile(r.profileRoot, r.manifestPath, f.binary)
  await writeFile(join(r.profileRoot, 'user/settings.xcu'), 'changed')
  await assert.rejects(prepare(join(f.root, 'changed-file')), /FILE_CHANGED/)
  await writeFile(f.binary, 'changed binary')
  await assert.rejects(prepare(join(f.root, 'changed-binary')), /DEPLOYMENT_CHANGED/)
  await writeFile(r.manifestPath, '{}')
  await assert.rejects(
    loadMockConverterProfile(r.profileRoot, r.manifestPath, f.binary),
    /MANIFEST/,
  )
})
test('traversal, duplicate paths and excessive size are rejected without copying', async (t) => {
  const f = await fixture(t),
    r = await bootstrapMockConverterProfile(
      f.bootstrap,
      Buffer.from('fake'),
      f.binary,
      (args) => ready(f.bootstrap, args),
      { fakeDataOnly: true },
    )
  const original = JSON.parse(await readFile(r.manifestPath, 'utf8')) as {
    files: { path: string; size: number; sha256: string }[]
  }
  for (const files of [
    [{ ...original.files[0]!, path: '../outside' }],
    [original.files[0]!, original.files[0]!],
    [{ ...original.files[0]!, size: 4 * 1024 * 1024 + 1 }],
  ]) {
    await writeFile(r.manifestPath, JSON.stringify({ ...original, files }))
    await assert.rejects(loadMockConverterProfile(r.profileRoot, r.manifestPath, f.binary), /ENTRY/)
  }
})

test('fake opt-in is mandatory before creating a bootstrap folder', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    bootstrapMockConverterProfile(
      f.bootstrap,
      Buffer.from('fake'),
      f.binary,
      async () => ({ outcome: 'EXITED', empty: true }),
      { fakeDataOnly: false } as unknown as { fakeDataOnly: true },
    ),
    /REQUIRES_FAKE_PROFILE_BOOTSTRAP/,
  )
  await assert.rejects(access(f.bootstrap))
})
test('a directory junction cannot redirect a selected profile entry', async (t) => {
  const f = await fixture(t),
    r = await bootstrapMockConverterProfile(
      f.bootstrap,
      Buffer.from('fake'),
      f.binary,
      (args) => ready(f.bootstrap, args),
      { fakeDataOnly: true },
    )
  const prepare = await loadMockConverterProfile(r.profileRoot, r.manifestPath, f.binary),
    other = join(f.root, 'other')
  await mkdir(other)
  await writeFile(join(other, 'settings.xcu'), 'synthetic settings')
  await rm(join(r.profileRoot, 'user'), { recursive: true })
  await symlink(
    other,
    join(r.profileRoot, 'user'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(prepare(join(f.root, 'redirected')), /UNSAFE_DOCUMENT_DIRECTORY/)
})
test('profile preparation failure never invokes conversion and releases the capacity slot', async () => {
  let calls = 0,
    preparations = 0,
    profile = ''
  const converter = new LibreOfficePdfConverter(
    process.execPath,
    async () => {
      calls++
    },
    async (path) => {
      preparations++
      profile = path
      throw new Error('PROFILE_CHANGED')
    },
  )
  for (let index = 0; index < 3; index++)
    await assert.rejects(
      converter.convert(Buffer.from('synthetic Word')),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_PDF_UNAVAILABLE',
    )
  assert.equal(calls, 0)
  assert.equal(preparations, 3)
  await assert.rejects(access(dirname(profile)))
})

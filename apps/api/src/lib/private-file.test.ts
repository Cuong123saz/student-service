import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { readPrivateFile } from './private-file.js'

async function fixture(t: TestContext) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-private-file-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-private-file-')))
    await rm(root, { recursive: true, force: true })
  })
  return { root, path: join(root, 'owned-file') }
}
test('private file preserves exact-limit binary bytes and refuses one byte over the limit', async (t) => {
  const f = await fixture(t),
    bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
  await writeFile(f.path, bytes)
  assert.deepEqual(await readPrivateFile(f.path, 256), bytes)
  await writeFile(f.path, Buffer.concat([bytes, Buffer.from([1])]))
  await assert.rejects(() => readPrivateFile(f.path, 256), /PRIVATE_FILE_UNAVAILABLE/)
})
test('private file rejects empty, missing and directory entries with a non-sensitive error', async (t) => {
  const f = await fixture(t)
  await assert.rejects(
    () => readPrivateFile(f.path, 10),
    (e) => e instanceof Error && e.message === 'PRIVATE_FILE_UNAVAILABLE',
  )
  await writeFile(f.path, Buffer.alloc(0))
  await assert.rejects(() => readPrivateFile(f.path, 10), /PRIVATE_FILE_UNAVAILABLE/)
  const directory = join(f.root, 'directory')
  await mkdir(directory)
  await assert.rejects(() => readPrivateFile(directory, 10), /PRIVATE_FILE_UNAVAILABLE/)
})
test('private file refuses invalid or excessive allocation limits', async (t) => {
  const f = await fixture(t)
  await writeFile(f.path, Buffer.from('fake'))
  for (const limit of [0, -1, 1.5, NaN, Infinity, 16 * 1024 * 1024 + 1])
    await assert.rejects(() => readPrivateFile(f.path, limit), /INVALID_PRIVATE_FILE_LIMIT/)
})
test('private file never follows a file symlink', async (t) => {
  const f = await fixture(t)
  await writeFile(f.path, Buffer.from('owned fake bytes'))
  const link = join(f.root, 'link')
  try {
    await symlink(f.path, link, 'file')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('Host does not permit creation of test symlinks')
      return
    }
    throw e
  }
  await assert.rejects(() => readPrivateFile(link, 100), /PRIVATE_FILE_UNAVAILABLE/)
})

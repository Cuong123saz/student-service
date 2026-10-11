// Only generates disposable synthetic artifacts for recovery rehearsal, not a production vault.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { fileDigest, assertRecoveryDirectory } from './recovery-bundle.mjs'
import { validateRecoveryAssets } from './recovery-assets.mjs'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const api = join(repo, 'apps/api')
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const digest = (bytes) => ({
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})
export async function createRecoveryDocumentFixture({ runId, runRoot, view, roundIds }) {
  assert.match(runId, uuid)
  assert.equal(resolve(runRoot), resolve(repo, 'run/recovery-drills', runId))
  await assertRecoveryDirectory(runRoot)
  assert.ok(view.rounds.length > 0 && view.rounds.length <= 10)
  const { LocalSubmissionDocumentRenderer } =
    await import('../dist/modules/submissions/submission-document.js')
  const { resolveDeclarationTemplate } =
    await import('../dist/modules/submissions/submission-document-template.js')
  const renderer = new LocalSubmissionDocumentRenderer()
  const command =
    process.env.LIBREOFFICE_PATH?.trim() ||
    (process.platform === 'win32' ? 'soffice.com' : 'soffice')
  const { stdout } = await promisify(execFile)(command, ['--version'], {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4096,
  })
  const converterVersion = stdout.trim().replace(/\s+/g, ' ').slice(0, 200)
  const rendererDigest = await fileDigest(
    join(api, 'dist/modules/submissions/submission-document.js'),
    1048576,
  )
  const rendererVersion =
    'sha256:' +
    rendererDigest.sha256 +
    '/node-' +
    process.versions.node +
    '/icu-' +
    process.versions.icu
  const templateRoot = join(runRoot, 'source-templates'),
    documentRoot = join(runRoot, 'source-documents')
  await mkdir(templateRoot, { mode: 0o700 })
  await mkdir(documentRoot, { mode: 0o700 })
  const templates = [],
    documents = []
  for (const round of view.rounds) {
    const binding = round.declarationTemplate,
      definition = resolveDeclarationTemplate(binding)
    if (!templates.some((template) => template.id === definition.id)) {
      const path = join(api, 'templates', definition.fileName),
        metadata = await fileDigest(path, 1048576)
      assert.equal(metadata.sha256, binding.sha256)
      await copyFile(path, join(templateRoot, definition.fileName), constants.COPYFILE_EXCL)
      templates.push({ id: definition.id, key: definition.fileName, ...metadata })
    }
    const result = await renderer.renderPair({
      id: view.id,
      serviceName: view.serviceName,
      procedure: view.procedure,
      round,
    })
    assert.deepEqual(result.template, binding)
    const roundId = roundIds.find((item) => item.roundNumber === round.roundNumber)?.id
    assert.match(roundId, uuid)
    const setId = randomUUID(),
      docxHash = digest(result.docx).sha256
    for (const [format, bytes] of [
      ['DOCX', result.docx],
      ['PDF', result.pdf],
    ]) {
      const key = randomUUID()
      await writeFile(join(documentRoot, key), bytes, { flag: 'wx', mode: 0o600 })
      documents.push({
        key,
        setId,
        roundId,
        submissionId: view.id,
        roundNumber: round.roundNumber,
        format,
        ...digest(bytes),
        template: { ...binding },
        rendererVersion,
        converterVersion: format === 'PDF' ? converterVersion : null,
        sourceDocxSha256: format === 'PDF' ? docxHash : null,
        kind: 'DECLARATION',
        status: 'UNSIGNED_DECLARATION',
      })
    }
  }
  const result = { templateRoot, documentRoot, templates, documents }
  validateRecoveryAssets({ version: 2, assetMetadataSource: 'TECHNICAL_FIXTURE', ...result })
  return result
}

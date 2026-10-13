// Bounded, read-only version probes. Does not connect to a database or accept an executable argument.
import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { assertDrillInvocation } from './recovery-bundle.mjs'
import { readWindowsDocumentProcessOutput } from '../dist/modules/submissions/submission-document-supervisor.js'
assertDrillInvocation(process.argv.slice(2), process.env)
assert.equal(process.platform, 'win32', 'WINDOWS_PROCESS_PROBE_ONLY')
const command = process.env.LIBREOFFICE_PATH || ''
assert.ok(isAbsolute(command) && command.endsWith('soffice.com'), 'ABSOLUTE_CONVERTER_REQUIRED')
let digest,
  failed = false
for (let sample = 1; sample <= 3; sample++) {
  let report
  try {
    const output = await readWindowsDocumentProcessOutput(command, ['--version'], 15000, {
      finished: (value) => {
        report = value
      },
    })
    const version = output.toString('utf8').trim()
    assert.ok(
      /^LibreOffice [0-9]+\.[0-9]+\.[0-9]+/.test(version) &&
        version.length <= 200 &&
        !/[\x00-\x1f\x7f]/.test(version),
      'INVALID_VERSION',
    )
    const current = createHash('sha256').update(version).digest('hex')
    if (digest) assert.equal(current, digest, 'VERSION_CHANGED')
    digest = current
    console.log(
      JSON.stringify({
        fakeDataOnly: true,
        sample,
        status: 'PASS',
        ...report,
        versionSha256: current,
      }),
    )
  } catch {
    failed = true
    console.log(
      JSON.stringify({
        fakeDataOnly: true,
        sample,
        status: 'FAIL',
        ...(report || { outcome: 'NOT_STARTED' }),
      }),
    )
    if (!report?.empty) break
  }
}
if (failed) process.exitCode = 1

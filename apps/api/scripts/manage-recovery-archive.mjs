import { fileURLToPath } from 'node:url'
import { assertDrillInvocation } from './recovery-bundle.mjs'
import { exportRecoveryBundle, inspectRecoveryArchive } from './recovery-archive.mjs'

try {
  const [flag, action, ...args] = process.argv.slice(2)
  assertDrillInvocation([flag], process.env)
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
  let report
  if (action === 'export' && args.length === 2) {
    report = await exportRecoveryBundle({ bundleRoot: args[0], archiveRoot: args[1], projectRoot })
  } else if (
    action === 'inspect' &&
    args.length === 3 &&
    /^[1-9][0-9]*$/.test(args[1]) &&
    /^[1-9][0-9]*$/.test(args[2])
  ) {
    report = await inspectRecoveryArchive({
      archiveRoot: args[0],
      projectRoot,
      policy: { keepLatest: Number(args[1]), minAgeDays: Number(args[2]) },
    })
  } else
    throw new Error(
      'USAGE_FAKE_FLAG_EXPORT_BUNDLE_ARCHIVE_OR_INSPECT_ARCHIVE_KEEP_LATEST_MIN_AGE_DAYS',
    )
  console.log(JSON.stringify(report, null, 2))
  if (report.status === 'ATTENTION' || report.status === 'EMPTY') process.exitCode = 2
} catch (error) {
  console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'ARCHIVE_OPERATION_FAILED')
  process.exitCode = 1
}

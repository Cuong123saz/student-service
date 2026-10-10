import { fileURLToPath } from 'node:url'
import { assertDrillInvocation } from './recovery-bundle.mjs'
import {
  createRecoveryKey,
  encryptRecoveryBundle,
  decryptRecoveryBundle,
  verifyEncryptedRecoveryBundle,
} from './encrypted-recovery.mjs'
try {
  const [flag, action, ...args] = process.argv.slice(2)
  assertDrillInvocation([flag], process.env)
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
  let result
  if (action === 'keygen' && args.length === 1)
    result = await createRecoveryKey({ keyPath: args[0], projectRoot })
  else if (action === 'encrypt' && args.length === 3)
    result = await encryptRecoveryBundle({
      bundleRoot: args[0],
      archiveRoot: args[1],
      keyPath: args[2],
      projectRoot,
    })
  else if (action === 'verify' && args.length === 2) {
    const data = await verifyEncryptedRecoveryBundle({
      packageRoot: args[0],
      keyPath: args[1],
      projectRoot,
    })
    result = {
      version: 1,
      fakeDataOnly: true,
      status: 'VERIFIED',
      runId: data.header.runId,
      keyId: data.header.keyId,
      files: data.manifest.files.length,
    }
  } else if (action === 'decrypt' && args.length === 3) {
    const manifest = await decryptRecoveryBundle({
      packageRoot: args[0],
      keyPath: args[1],
      targetRoot: args[2],
      projectRoot,
    })
    result = {
      version: 1,
      fakeDataOnly: true,
      status: 'VERIFIED',
      runId: manifest.runId,
      files: manifest.files.length,
    }
  } else throw new Error('INVALID_ENCRYPTED_RECOVERY_OPTIONS')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(
    /^[A-Z_]+$/.test(error.message) ? error.message : 'ENCRYPTED_RECOVERY_OPERATION_FAILED',
  )
  process.exitCode = 1
}

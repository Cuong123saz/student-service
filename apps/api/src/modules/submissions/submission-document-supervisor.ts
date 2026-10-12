import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateFile } from '../../lib/private-file.js'
export class DocumentProcessUncertainError extends Error {
  constructor() {
    super('DOCUMENT_PROCESS_TERMINATION_UNCERTAIN')
  }
}
export interface DocumentProcessObserver {
  started?(ownerPid: number, converterPid: number): void
}
let quarantined = false
async function windowsProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  observer?: DocumentProcessObserver,
  captureOutput = false,
) {
  if (quarantined) throw new DocumentProcessUncertainError()
  if (
    !isAbsolute(command) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 90000 ||
    args.length > 100 ||
    [command, ...args].some((value) => typeof value !== 'string' || value.includes('\0'))
  )
    throw new Error('INVALID_DOCUMENT_PROCESS_CONFIG')
  const header =
    JSON.stringify({
      command,
      args,
      timeoutMs,
      deadlineUnixMs: Date.now() + timeoutMs,
      captureOutput,
    }) + '\n'
  if (Buffer.byteLength(header) > 65536) throw new Error('INVALID_DOCUMENT_PROCESS_CONFIG')
  const script = fileURLToPath(new URL('./windows-document-supervisor.ps1', import.meta.url))
  await readPrivateFile(script, 65536)
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] },
    )
    let bytes = 0,
      pending = '',
      started = false,
      timedOut = false,
      unsafe = false,
      spawnFailed = false
    let result: { reason: string; empty: boolean; output: Buffer } | undefined
    let reapTimer: ReturnType<typeof setTimeout> | undefined
    const kill = () => {
      unsafe = true
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.stdin.write('cancel\n', () => {})
      reapTimer = setTimeout(kill, 10000)
    }, timeoutMs)
    child.stdin.on('error', () => {})
    child.once('error', () => {
      spawnFailed = true
    })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 8192) {
        kill()
        return
      }
      pending += chunk.toString('utf8')
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        try {
          const message = JSON.parse(line) as Record<string, unknown>
          if (
            message.type === 'STARTED' &&
            !started &&
            !result &&
            Number.isInteger(message.pid) &&
            Number(message.pid) > 0 &&
            Object.keys(message).length === 2
          ) {
            started = true
            observer?.started?.(child.pid!, Number(message.pid))
          } else if (
            message.type === 'RESULT' &&
            !result &&
            typeof message.empty === 'boolean' &&
            typeof message.reason === 'string' &&
            ['EXITED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ABANDONED_CHILD'].includes(
              message.reason,
            ) &&
            ((Object.keys(message).length === 3 && !captureOutput) ||
              (captureOutput &&
                Object.keys(message).length === 4 &&
                typeof message.outputBase64 === 'string' &&
                message.outputBase64.length <= 5464 &&
                Buffer.from(message.outputBase64, 'base64').length <= 4096 &&
                Buffer.from(message.outputBase64, 'base64').toString('base64') ===
                  message.outputBase64) ||
              (captureOutput && Object.keys(message).length === 3 && message.reason === 'FAILED'))
          ) {
            result = {
              reason: message.reason,
              empty: message.empty,
              output:
                typeof message.outputBase64 === 'string'
                  ? Buffer.from(message.outputBase64, 'base64')
                  : Buffer.alloc(0),
            }
          } else kill()
        } catch {
          kill()
        }
      }
    })
    child.once('close', () => {
      clearTimeout(timer)
      if (reapTimer) clearTimeout(reapTimer)
      child.stdin.destroy()
      if (spawnFailed && !started) reject(new Error('DOCUMENT_SUPERVISOR_UNAVAILABLE'))
      else if (unsafe || !result?.empty || pending.trim()) {
        quarantined = true
        reject(new DocumentProcessUncertainError())
      } else if (timedOut || result.reason === 'TIMEOUT' || result.reason === 'CANCELLED')
        reject(new Error('DOCUMENT_CONVERSION_TIMEOUT'))
      else if (result.reason === 'EXITED' && started) resolve(result.output)
      else reject(new Error('DOCUMENT_CONVERSION_FAILED'))
    })
    child.stdin.write(header, () => {})
  })
}

export async function runWindowsDocumentProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  observer?: DocumentProcessObserver,
): Promise<void> {
  await windowsProcess(command, args, timeoutMs, observer)
}
export function readWindowsDocumentProcessOutput(
  command: string,
  args: string[],
  timeoutMs: number,
  observer?: DocumentProcessObserver,
) {
  return windowsProcess(command, args, timeoutMs, observer, true)
}

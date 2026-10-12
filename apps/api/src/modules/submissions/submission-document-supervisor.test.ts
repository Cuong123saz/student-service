import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { fork, spawn, type ForkOptions } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  runWindowsDocumentProcess,
  readWindowsDocumentProcessOutput,
  DocumentProcessUncertainError,
} from './submission-document-supervisor.js'
import { LibreOfficePdfConverter } from './submission-document.js'
import { SubmissionError } from './submission.types.js'
async function fixture(t: TestContext) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'student-document-process-'))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-document-process-')))
    await rm(root, { recursive: true, force: true })
  })
  return { root, info: join(root, 'children.json') }
}
function active(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
async function gone(pids: number[]) {
  for (let i = 0; i < 140; i++) {
    if (pids.every((pid) => !active(pid))) return
    await delay(50)
  }
  assert.deepEqual(pids.filter(active), [], 'owned converter process must be gone')
}
async function infoFile(path: string) {
  for (let i = 0; i < 140; i++) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as { root: number; child: number }
    } catch {
      await delay(50)
    }
  }
  throw new Error('OWNED_FIXTURE_NOT_STARTED')
}
function ownerWorker(path: string) {
  const options: ForkOptions & { windowsHide: boolean } = {
    execArgv: ['--import', 'tsx'],
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  }
  return fork(path, [], options)
}
const sleeper = 'setInterval(()=>{},1000)'
function program(info: string, abandon = false, realCommand?: string, realArgs: string[] = []) {
  return `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(${JSON.stringify(realCommand ?? process.execPath)},${JSON.stringify(realCommand ? realArgs : ['-e', sleeper])},{windowsHide:true,stdio:'ignore',shell:false,detached:true});fs.writeFileSync(${JSON.stringify(info)},JSON.stringify({root:process.pid,child:c.pid}));${abandon ? 'setTimeout(()=>process.exit(0),200)' : 'setInterval(()=>{},1000)'}`
}
if (process.platform === 'win32') {
  for (const run of [runWindowsDocumentProcess, readWindowsDocumentProcessOutput])
    test(
      'Windows atomic job kills timed-out root and child before returning capacity: ' + run.name,
      async (t) => {
        const f = await fixture(t)
        let supervisor = 0,
          root = 0
        const outcome = run(process.execPath, ['-e', program(f.info)], 6000, {
          started: (owner, pid) => {
            supervisor = owner
            root = pid
          },
        }).catch((e) => e as unknown)
        const tree = await infoFile(f.info)
        assert.equal(tree.root, root)
        const error = await outcome
        assert.ok(error instanceof Error && error.message === 'DOCUMENT_CONVERSION_TIMEOUT')
        assert.equal(active(root), false)
        assert.equal(active(tree.child), false)
        assert.equal(active(supervisor), false)
      },
    )
  test('Windows argument quoting preserves Unicode, quotes, spaces, empty and trailing backslashes without a shell', async (t) => {
    const f = await fixture(t),
      output = join(f.root, 'argument output.json'),
      values = ['with spaces', 'a"b', 'C:\\space dir\\', '', 'Nguyễn Minh An', 'a&b;$(unused)']
    await runWindowsDocumentProcess(
      process.execPath,
      [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)))",
        output,
        ...values,
      ],
      10000,
    )
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), values)
  })
  test('root exiting without its child is rejected and its entire job is reaped', async (t) => {
    const f = await fixture(t)
    const outcome = runWindowsDocumentProcess(
      process.execPath,
      ['-e', program(f.info, true)],
      10000,
    ).catch((e) => e as unknown)
    const tree = await infoFile(f.info)
    const error = await outcome
    assert.ok(
      error instanceof Error && error.message === 'DOCUMENT_CONVERSION_FAILED',
      error instanceof Error ? error.message : String(error),
    )
    assert.equal(active(tree.root), false)
    assert.equal(active(tree.child), false)
  })
  for (const runName of ['runWindowsDocumentProcess', 'readWindowsDocumentProcessOutput'])
    for (const killTarget of ['owner', 'supervisor'] as const)
      test(
        'killing the owned ' + killTarget + ' cannot orphan its Windows converter job: ' + runName,
        async (t) => {
          const f = await fixture(t),
            worker = join(f.root, 'owner.mjs')
          const module = pathToFileURL(
            fileURLToPath(new URL('./submission-document-supervisor.ts', import.meta.url)),
          ).href
          await writeFile(
            worker,
            `import {${runName}} from ${JSON.stringify(module)};try {await ${runName}(process.execPath,['-e',${JSON.stringify(program(f.info))}],30000,{started:(supervisor,pid)=>process.send({supervisor,pid})});process.send({done:true})}catch(e){let secondError;try{await ${runName}(process.execPath,['-e','process.exit(0)'],10000)}catch(second){secondError=second.message}process.send({error:e.message,secondError})}process.disconnect()`,
          )
          const child = ownerWorker(worker)
          const messages: Record<string, unknown>[] = []
          child.on('message', (message) => messages.push(message as Record<string, unknown>))
          const closed = new Promise((res) => child.once('exit', res))
          t.after(async () => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
            await closed
          })
          const started = await new Promise<{ supervisor: number; pid: number }>((res, rej) => {
            const timer = setTimeout(() => rej(new Error('OWNER_NOT_STARTED')), 10000)
            child.once('message', (message) => {
              clearTimeout(timer)
              res(message as { supervisor: number; pid: number })
            })
          })
          const tree = await infoFile(f.info)
          assert.equal(tree.root, started.pid)
          if (killTarget === 'owner') child.kill('SIGKILL')
          else process.kill(started.supervisor, 'SIGKILL')
          await closed
          await gone([tree.root, tree.child, started.supervisor])
          if (killTarget === 'supervisor')
            assert.deepEqual(messages.at(-1), {
              error: 'DOCUMENT_PROCESS_TERMINATION_UNCERTAIN',
              secondError: 'DOCUMENT_PROCESS_TERMINATION_UNCERTAIN',
            })
        },
      )
  test('captured output preserves Unicode and its exact 4096-byte bound', async () => {
    for (const value of ['Phiếu sinh viên Nguyễn Minh An\n', 'x'.repeat(4096)]) {
      const output = await readWindowsDocumentProcessOutput(
        process.execPath,
        ['-e', 'process.stdout.write(' + JSON.stringify(value) + ')'],
        10000,
      )
      assert.equal(output.toString('utf8'), value)
    }
  })
  test('output overflow and nonzero exit fail without quarantining a reaped job', async () => {
    for (const script of [
      'process.stdout.write("x".repeat(4097));setInterval(()=>{},1000)',
      'process.stderr.write("private converter error");process.exitCode=7',
    ])
      await assert.rejects(
        readWindowsDocumentProcessOutput(process.execPath, ['-e', script], 10000),
        /^Error: DOCUMENT_CONVERSION_FAILED$/,
      )
    assert.equal(
      (
        await readWindowsDocumentProcessOutput(
          process.execPath,
          ['-e', 'process.stdout.write("ready")'],
          10000,
        )
      ).toString(),
      'ready',
    )
  })
  test('expired startup deadline refuses to create the converter', async () => {
    let started = 0
    await assert.rejects(
      runWindowsDocumentProcess(process.execPath, ['-e', sleeper], 1, {
        started: () => {
          started++
        },
      }),
      /DOCUMENT_CONVERSION_TIMEOUT/,
    )
    assert.equal(started, 0)
  })
  test('invalid config refuses to start a Windows process', async () => {
    for (const [command, args, time] of [
      ['relative', [], 1000],
      [process.execPath, [], 0],
      [process.execPath, ['bad\0arg'], 1000],
      [process.execPath, [], 90001],
    ] as [string, string[], number][])
      await assert.rejects(
        runWindowsDocumentProcess(command, args, time),
        /INVALID_DOCUMENT_PROCESS_CONFIG/,
      )
  })
}
test('uncertain termination quarantines the converter and retains its working files for inspection', async () => {
  let calls = 0,
    root = ''
  const converter = new LibreOfficePdfConverter(process.execPath, (_command, args) => {
    calls++
    root = args[args.indexOf('--outdir') + 1]!
    return Promise.reject(new DocumentProcessUncertainError())
  })
  try {
    await assert.rejects(
      converter.convert(Buffer.from('synthetic Word')),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_PDF_UNAVAILABLE',
    )
    await access(join(root, 'input.docx'))
    await assert.rejects(
      converter.convert(Buffer.from('synthetic Word')),
      (e) => e instanceof SubmissionError && e.code === 'DOCUMENT_CONVERTER_QUARANTINED',
    )
    assert.equal(calls, 1)
  } finally {
    const parent = resolve(tmpdir())
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'student-service-document-')))
    await rm(root, { recursive: true, force: true })
  }
})
if (process.platform === 'win32' && process.env.DOCUMENT_SUPERVISOR_REAL_CONVERTER === 'true') {
  test('real LibreOffice version output uses the bounded supervisor protocol', async () => {
    const output = await readWindowsDocumentProcessOutput(
      process.env.LIBREOFFICE_PATH!,
      ['--version'],
      10000,
    )
    assert.match(output.toString('utf8').trim(), /^LibreOffice [0-9]+\.[0-9]+\.[0-9]+/)
    assert.ok(output.length <= 4096)
  })
  for (const killTarget of ['owner', 'supervisor'] as const)
    test(
      'real LibreOffice children stop after ' + killTarget + ' death in an isolated profile',
      async (t) => {
        const command = process.env.LIBREOFFICE_PATH!
        assert.ok(command && command.endsWith('soffice.com'))
        const f = await fixture(t),
          worker = join(f.root, 'owner.mjs'),
          profile = pathToFileURL(join(f.root, 'lo-profile')).href
        const args = [
          '-env:UserInstallation=' + profile,
          '--headless',
          '--nologo',
          '--norestore',
          '--nodefault',
          '--nofirststartwizard',
          '--accept=pipe,name=student-supervisor-' +
            randomUUID() +
            ';urp;StarOffice.ComponentContext',
        ]
        const module = pathToFileURL(
          fileURLToPath(new URL('./submission-document-supervisor.ts', import.meta.url)),
        ).href
        await writeFile(
          worker,
          `import {runWindowsDocumentProcess} from ${JSON.stringify(module)};try{await runWindowsDocumentProcess(process.execPath,['-e',${JSON.stringify(program(f.info, false, command, args))}],30000,{started:(supervisor,pid)=>process.send({supervisor,pid})})}catch{}process.disconnect()`,
        )
        const child = ownerWorker(worker)
        const closed = new Promise((res) => child.once('exit', res))
        t.after(async () => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
          await closed
        })
        const started = await new Promise<{ supervisor: number; pid: number }>((res, rej) => {
          const timer = setTimeout(() => rej(new Error('OWNER_NOT_STARTED')), 10000)
          child.once('message', (m) => {
            clearTimeout(timer)
            res(m as { supervisor: number; pid: number })
          })
        })
        const tree = await infoFile(f.info)
        // Enumerate only descendants of this exact owned soffice.com process.
        const query = `$p=Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${tree.child}';$p | Select-Object ProcessId,Name | ConvertTo-Json -Compress`
        const scan = spawn(
          join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', query],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], shell: false },
        )
        let output = ''
        scan.stdout.on('data', (b) => {
          output += String(b)
        })
        await new Promise((res) => scan.once('exit', res))
        const processes = JSON.parse(output) as
          { ProcessId: number; Name: string } | { ProcessId: number; Name: string }[]
        const descendants = Array.isArray(processes) ? processes : [processes]
        assert.ok(descendants.some((p) => p.Name === 'soffice.bin'))
        if (killTarget === 'owner') child.kill('SIGKILL')
        else process.kill(started.supervisor, 'SIGKILL')
        await closed
        await gone([
          tree.root,
          tree.child,
          started.supervisor,
          ...descendants.map((p) => p.ProcessId),
        ])
      },
    )
}

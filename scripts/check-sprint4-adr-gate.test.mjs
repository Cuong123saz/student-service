import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const gatePath = fileURLToPath(new URL('./check-sprint4-adr-gate.mjs', import.meta.url))
const adrPath = 'docs/adr/0001-submission-workflow.md'
const protectedTables = [
  'procedure_versions',
  'procedure_form_configs',
  'attachment_requirements',
  'workflow_definitions',
  'workflow_steps',
  'submissions',
  'submission_files',
  'form_versions',
  'reviewer_queue',
]

function fixture(t, { adr, closure = { sprint: '2+3', status: 'CLOSED' } } = {}) {
  const tempRoot = resolve(tmpdir())
  const root = mkdtempSync(join(tempRoot, 'student-service-adr-gate-'))
  t.after(() => {
    assert.equal(dirname(root), tempRoot)
    assert.ok(root.startsWith(join(tempRoot, 'student-service-adr-gate-')))
    rmSync(root, { recursive: true, force: true })
  })

  function git(...args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }

  function write(path, content) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  function commit() {
    git('add', '.')
    git(
      '-c',
      'core.hooksPath=.git/empty-hooks',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'fixture',
    )
    return git('rev-parse', 'HEAD')
  }

  function run(base, head = 'HEAD') {
    const result = spawnSync(process.execPath, [gatePath, base, head], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.ifError(result.error)
    return { status: result.status, output: result.stdout + result.stderr }
  }

  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'ADR gate fixture')
  git('config', 'user.email', 'adr-gate@example.test')
  write('README.md', '# Fixture\n')
  if (closure !== null) {
    write(
      'docs/sprint-status.json',
      typeof closure === 'string' ? closure : JSON.stringify(closure),
    )
  }
  if (adr !== undefined) {
    write(adrPath, '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0003-student-drafts-and-evidence.md', '---\nstatus: ' + adr + '\n---\n')
  }
  const base = commit()
  return { write, commit, run, base }
}

test('unrelated migrations do not require a Sprint 4 ADR', (t) => {
  const repo = fixture(t, { closure: null })
  repo.write('apps/api/drizzle/0014_other.sql', 'CREATE TABLE other_table (id integer);\n')
  repo.commit()
  const result = repo.run(repo.base)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /no related migration changes detected/u)
})

for (const table of protectedTables) {
  test('migration touching ' + table + ' requires an ADR on the base revision', (t) => {
    const repo = fixture(t)
    repo.write(
      'apps/api/drizzle/0014_configuration.sql',
      'CREATE TABLE "' + table + '" (id integer);\n',
    )
    repo.commit()
    const result = repo.run(repo.base)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /must be committed before/u)
    assert.ok(result.output.includes(table))
  })
}

test('an Accepted ADR and closed Sprint 2+3 before protected migrations pass', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  repo.write(
    'apps/api/drizzle/0014_configuration.sql',
    protectedTables.map((table) => 'CREATE TABLE "' + table + '" (id integer);').join('\n'),
  )
  repo.commit()
  const result = repo.run(repo.base)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /required ADR predate the migration changes/u)
})

test('a Proposed ADR cannot be accepted together with the migration', (t) => {
  const repo = fixture(t, { adr: 'Proposed' })
  repo.write(adrPath, '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0014_configuration.sql',
    'CREATE TABLE workflow_steps (id integer);\n',
  )
  repo.commit()
  const result = repo.run(repo.base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /was not Accepted before/u)
})

test('adding an Accepted ADR in the migration change is too late', (t) => {
  const repo = fixture(t)
  repo.write(adrPath, '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0014_configuration.sql',
    'CREATE TABLE procedure_versions (id integer);\n',
  )
  repo.commit()
  const result = repo.run(repo.base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /must be committed before/u)
})

for (const [label, closure] of [
  ['missing', null],
  ['open', { sprint: '2+3', status: 'OPEN' }],
  ['wrong sprint', { sprint: '4', status: 'CLOSED' }],
  ['invalid JSON', '{invalid'],
]) {
  test('an Accepted ADR with ' + label + ' baseline closure is rejected', (t) => {
    const repo = fixture(t, { adr: 'Accepted', closure })
    repo.write(
      'apps/api/drizzle/0014_configuration.sql',
      'CREATE TABLE procedure_versions (id integer);\n',
    )
    repo.commit()
    const result = repo.run(repo.base)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /sprint-status\.json/u)
  })
}

test('closing Sprint 2+3 in the migration change is too late', (t) => {
  const repo = fixture(t, { adr: 'Accepted', closure: { sprint: '2+3', status: 'OPEN' } })
  repo.write('docs/sprint-status.json', JSON.stringify({ sprint: '2+3', status: 'CLOSED' }))
  repo.write(
    'apps/api/drizzle/0014_configuration.sql',
    'CREATE TABLE workflow_steps (id integer);\n',
  )
  repo.commit()
  const result = repo.run(repo.base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /was not CLOSED/u)
})

test('modifying an existing migration still requires prior approval', (t) => {
  const repo = fixture(t)
  repo.write('apps/api/drizzle/0014_configuration.sql', 'SELECT 1;\n')
  const base = repo.commit()
  repo.write(
    'apps/api/drizzle/0014_configuration.sql',
    'ALTER TABLE workflow_steps ADD COLUMN label text;\n',
  )
  repo.commit()
  const result = repo.run(base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /must be committed before/u)
})

test('invalid revisions fail instead of silently skipping the gate', (t) => {
  const repo = fixture(t)
  const result = repo.run('missing-revision')
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /cannot resolve revisions/u)
})

test('student evidence requires its own ADR before migration even when workflow ADR was accepted', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  repo.write('docs/adr/0003-student-drafts-and-evidence.md', '---\nstatus: Proposed\n---\n')
  const base = repo.commit()
  repo.write('docs/adr/0003-student-drafts-and-evidence.md', '---\nstatus: Accepted\n---\n')
  repo.write('apps/api/drizzle/0015_evidence.sql', 'CREATE TABLE submission_files (id integer);\n')
  repo.commit()
  const result = repo.run(base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /0003-student-drafts-and-evidence/u)
  assert.match(result.output, /was not Accepted before/u)
})

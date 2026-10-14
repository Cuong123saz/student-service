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
  'training_periods',
  'training_declarations',
  'training_evidence',
  'training_events',
  'procedure_versions',
  'procedure_form_configs',
  'attachment_requirements',
  'workflow_definitions',
  'workflow_steps',
  'submissions',
  'submission_files',
  'submission_rounds',
  'submission_document_sets',
  'submission_documents',
  'submission_document_jobs',
  'submission_document_retries',
  'mock_signature_receipts',
  'mock_signature_checks',
  'submission_events',
  'personal_notifications',
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
    write('docs/adr/0019-training-points-foundation.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0018-mock-signing-workflow.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0011-controlled-document-retry.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0010-document-vault-and-recovery.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0009-immutable-generated-documents.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0008-review-search-index.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0007-review-queue-pagination.md', '---\nstatus: ' + adr + '\n---\n')
    write(adrPath, '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0003-student-drafts-and-evidence.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0004-submission-and-intake.md', '---\nstatus: ' + adr + '\n---\n')
    write('docs/adr/0005-submission-resolution.md', '---\nstatus: ' + adr + '\n---\n')
    write(
      'docs/adr/0006-submission-reassignment-and-notifications.md',
      '---\nstatus: ' + adr + '\n---\n',
    )
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

test('submission intake ADR must be accepted before changing submitted records', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  repo.write('docs/adr/0004-submission-and-intake.md', '---\nstatus: Proposed\n---\n')
  const base = repo.commit()
  repo.write('docs/adr/0004-submission-and-intake.md', '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0016_intake.sql',
    'ALTER TABLE submissions ADD COLUMN submitted_at timestamptz;\n',
  )
  repo.commit()
  const result = repo.run(base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /0004-submission-and-intake/u)
  assert.match(result.output, /was not Accepted before/u)
})

for (const table of ['submissions', 'submission_files', 'submission_rounds', 'submission_events']) {
  test('resolution ADR must predate changes to ' + table, (t) => {
    const repo = fixture(t, { adr: 'Accepted' })
    repo.write('docs/adr/0005-submission-resolution.md', '---\nstatus: Proposed\n---\n')
    const base = repo.commit()
    repo.write('docs/adr/0005-submission-resolution.md', '---\nstatus: Accepted\n---\n')
    repo.write(
      'apps/api/drizzle/0017_resolution.sql',
      'ALTER TABLE ' + table + ' ADD COLUMN round_number integer;\n',
    )
    repo.commit()
    const result = repo.run(base)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /0005-submission-resolution/u)
    assert.match(result.output, /was not Accepted before/u)
  })
}

for (const table of ['submissions', 'submission_events', 'personal_notifications']) {
  test('reassignment ADR must predate changes to ' + table, (t) => {
    const repo = fixture(t, { adr: 'Accepted' })
    repo.write(
      'docs/adr/0006-submission-reassignment-and-notifications.md',
      '---\nstatus: Proposed\n---\n',
    )
    const base = repo.commit()
    repo.write(
      'docs/adr/0006-submission-reassignment-and-notifications.md',
      '---\nstatus: Accepted\n---\n',
    )
    repo.write(
      'apps/api/drizzle/0018_handover.sql',
      'ALTER TABLE ' + table + ' ADD COLUMN read_at timestamptz;\n',
    )
    repo.commit()
    const result = repo.run(base)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /0006-submission-reassignment-and-notifications/u)
    assert.match(result.output, /was not Accepted before/u)
  })
}

test('queue pagination ADR must predate a submission index migration', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  repo.write('docs/adr/0007-review-queue-pagination.md', '---\nstatus: Proposed\n---\n')
  const base = repo.commit()
  repo.write('docs/adr/0007-review-queue-pagination.md', '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0019_queue.sql',
    'CREATE INDEX queue_idx ON submissions (status,submitted_at,id);\n',
  )
  repo.commit()
  const result = repo.run(base)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /0007-review-queue-pagination/u)
})

test('search-index ADR cannot be accepted together with its submissions migration', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  repo.write('docs/adr/0008-review-search-index.md', '---\nstatus: Proposed\n---\n')
  const before = repo.commit()
  repo.write('docs/adr/0008-review-search-index.md', '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0020_search.sql',
    'CREATE INDEX search_idx ON submissions (service_name);',
  )
  repo.commit()
  const result = repo.run(before)
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, /0008-review-search-index/)
})

test('template-binding ADR must be accepted before its round migration, not in the same commit', (t) => {
  const repo = fixture(t, { adr: 'Accepted' })
  const path = 'docs/adr/0009-immutable-generated-documents.md'
  repo.write(path, '---\nstatus: Proposed\n---\n')
  const base = repo.commit()
  repo.write(path, '---\nstatus: Accepted\n---\n')
  repo.write(
    'apps/api/drizzle/0022_round_declaration_template.sql',
    'ALTER TABLE submission_rounds ADD COLUMN declaration_template jsonb;\n',
  )
  repo.commit()
  const result = repo.run(base)
  assert.equal(result.status, 1, result.output)
  assert.match(
    result.output,
    /0009-immutable-generated-documents\.md existed but was not Accepted before/u,
  )
})

for (const table of [
  'submission_document_sets',
  'submission_documents',
  'submission_document_jobs',
]) {
  test('vault migration requires ADR0010 accepted before ' + table, (t) => {
    const repo = fixture(t, { adr: 'Accepted' })
    const path = 'docs/adr/0010-document-vault-and-recovery.md'
    repo.write(path, '---\nstatus: Proposed\n---\n')
    const base = repo.commit()
    repo.write(path, '---\nstatus: Accepted\n---\n')
    repo.write('apps/api/drizzle/0023_fixture.sql', 'CREATE TABLE ' + table + ' (id uuid);\n')
    repo.commit()
    const result = repo.run(base)
    assert.equal(result.status, 1, result.output)
    assert.match(
      result.output,
      /0010-document-vault-and-recovery\.md existed but was not Accepted before/u,
    )
  })
}

for (const table of ['submission_document_jobs', 'submission_document_retries'])
  test('controlled retry requires ADR0011 before ' + table, (t) => {
    const repo = fixture(t, { adr: 'Accepted' }),
      path = 'docs/adr/0011-controlled-document-retry.md'
    repo.write(path, '---\nstatus: Proposed\n---\n')
    const base = repo.commit()
    repo.write(path, '---\nstatus: Accepted\n---\n')
    repo.write(
      'apps/api/drizzle/0024_fixture.sql',
      'ALTER TABLE ' + table + ' ADD COLUMN extra integer;\n',
    )
    repo.commit()
    const result = repo.run(base)
    assert.equal(result.status, 1, result.output)
    assert.match(
      result.output,
      /0011-controlled-document-retry\.md existed but was not Accepted before/u,
    )
  })

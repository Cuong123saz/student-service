import { execFileSync } from 'node:child_process'

const tableAdrMap = new Map([
  ['procedure_versions', 'docs/adr/0001-submission-workflow.md'],
  ['procedure_form_configs', 'docs/adr/0001-submission-workflow.md'],
  ['attachment_requirements', 'docs/adr/0001-submission-workflow.md'],
  ['workflow_definitions', 'docs/adr/0001-submission-workflow.md'],
  ['workflow_steps', 'docs/adr/0001-submission-workflow.md'],
  [
    'submissions',
    [
      'docs/adr/0003-student-drafts-and-evidence.md',
      'docs/adr/0004-submission-and-intake.md',
      'docs/adr/0005-submission-resolution.md',
      'docs/adr/0006-submission-reassignment-and-notifications.md',
      'docs/adr/0007-review-queue-pagination.md',
    ],
  ],
  [
    'submission_files',
    [
      'docs/adr/0003-student-drafts-and-evidence.md',
      'docs/adr/0004-submission-and-intake.md',
      'docs/adr/0005-submission-resolution.md',
      'docs/adr/0006-submission-reassignment-and-notifications.md',
    ],
  ],
  ['submission_rounds', 'docs/adr/0005-submission-resolution.md'],
  [
    'submission_events',
    [
      'docs/adr/0005-submission-resolution.md',
      'docs/adr/0006-submission-reassignment-and-notifications.md',
    ],
  ],
  ['personal_notifications', 'docs/adr/0006-submission-reassignment-and-notifications.md'],
  ['form_versions', 'docs/adr/0001-submission-workflow.md'],
  ['reviewer_queue', 'docs/adr/0001-submission-workflow.md'],
])

const runGit = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const commitExists = (revision) => {
  try {
    runGit('cat-file', '-e', `${revision}^{commit}`)
    return true
  } catch {
    return false
  }
}

const baseRevision = process.argv[2] || 'HEAD^'
const headRevision = process.argv[3] || 'HEAD'

if (!commitExists(baseRevision) || !commitExists(headRevision)) {
  console.error(`Sprint 4 ADR gate cannot resolve revisions: ${baseRevision}..${headRevision}`)
  process.exit(1)
}

const changedMigrations = runGit(
  'diff',
  '--name-only',
  '--diff-filter=AMR',
  baseRevision,
  headRevision,
  '--',
  'apps/api/drizzle/*.sql',
)
  .split(/\r?\n/u)
  .filter(Boolean)

const requirements = new Map()

for (const migration of changedMigrations) {
  const sql = runGit('show', `${headRevision}:${migration}`)

  for (const [table, adrs] of tableAdrMap) {
    if (new RegExp(`\\b${table}\\b`, 'iu').test(sql)) {
      for (const adr of [adrs].flat()) {
        const migrations = requirements.get(adr) || []
        migrations.push(`${migration} (${table})`)
        requirements.set(adr, migrations)
      }
    }
  }
}

if (requirements.size === 0) {
  console.log('Sprint 4 ADR gate passed: no related migration changes detected.')
  process.exit(0)
}

const failures = []

try {
  const status = JSON.parse(runGit('show', `${baseRevision}:docs/sprint-status.json`))
  if (status.sprint !== '2+3' || status.status !== 'CLOSED') {
    failures.push('docs/sprint-status.json was not CLOSED for Sprint 2+3 on the base revision')
  }
} catch {
  failures.push('docs/sprint-status.json did not exist or was invalid on the base revision')
}

for (const [adr, migrations] of requirements) {
  try {
    const content = runGit('show', `${baseRevision}:${adr}`)
    if (!/^status:\s*Accepted\s*$/imu.test(content)) {
      failures.push(`${adr} existed but was not Accepted before: ${migrations.join(', ')}`)
    }
  } catch {
    failures.push(`${adr} must be committed before: ${migrations.join(', ')}`)
  }
}

if (failures.length > 0) {
  console.error('Sprint 4 ADR gate failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  'Sprint 4 ADR gate passed: closure artefact and required ADR predate the migration changes.',
)

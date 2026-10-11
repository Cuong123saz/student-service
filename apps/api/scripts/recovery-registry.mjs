import assert from 'node:assert/strict'
import { assertDrillDatabase, targetDatabase } from './recovery-bundle.mjs'
// This mutating preparation is only for a restored, isolated rehearsal database, before its API starts.
export async function invalidateRestoredDocumentLeases({ sql, databaseUrl, runId }) {
  assertDrillDatabase(databaseUrl, targetDatabase)
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  const [current] =
    await sql`SELECT current_database() AS name,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS others`
  assert.equal(current.name, targetDatabase)
  assert.equal(current.others, 0)
  return sql.begin(async (tx) => {
    await tx`SELECT s.id FROM submission_document_sets s WHERE EXISTS(SELECT 1 FROM submission_document_jobs j WHERE j.set_id=s.id AND j.state='RUNNING') ORDER BY s.id FOR UPDATE`
    const jobs =
      await tx`SELECT id,set_id AS "setId",attempt_id AS "attemptId",format FROM submission_document_jobs WHERE state='RUNNING' ORDER BY id FOR UPDATE`
    for (const job of jobs) {
      await tx`UPDATE submission_document_jobs SET state='RETRYABLE',lease_until=NULL,error_code='LEASE_EXPIRED',next_attempt_at=clock_timestamp()+interval '3 seconds' WHERE id=${job.id} AND attempt_id=${job.attemptId} AND state='RUNNING'`
      await tx`INSERT INTO audit_logs(actor_type,action,resource_type,resource_id,outcome,metadata) VALUES('SYSTEM','document.recovery.lease.invalidated','submission_document_job',${job.id},'SUCCESS',${tx.json({ runId, setId: job.setId, attemptId: job.attemptId, format: job.format, reason: 'ISOLATED_RESTORE' })})`
    }
    return jobs.length
  })
}

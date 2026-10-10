// Read-only diagnostics on the isolated dataset owned by check-concurrency.mjs.
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createHash } from 'node:crypto'

export async function profileReviewSearch({ actors, cleanPending = false }) {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.port === '5434' &&
      url.pathname === '/student_service_test',
  )
  assert.equal(process.env.APP_ENV, 'test')
  const { DrizzleSubmissionRepository } =
    await import('../dist/modules/submissions/submission.repository.js')
  const { databaseClient } = await import('../dist/db/client.js')
  const client = postgres(process.env.DATABASE_URL, { max: 10 })
  let timings = [],
    queries = [],
    capture = true
  const wrapped = new Proxy(client, {
    get(target, key) {
      if (key === 'begin')
        return async (callback) => {
          const start = performance.now()
          let acquired, bodyEnd
          const value = await target.begin(async (tx) => {
            acquired = performance.now()
            const result = await callback(tx)
            bodyEnd = performance.now()
            return result
          })
          timings.push({
            beginWaitMs: acquired - start,
            bodyMs: bodyEnd - acquired,
            totalMs: performance.now() - start,
          })
          return value
        }
      return Reflect.get(target, key)
    },
  })
  const repository = new DrizzleSubmissionRepository(
    drizzle(wrapped, {
      logger: {
        logQuery(sql, params) {
          if (capture) queries.push({ sql, params })
        },
      },
    }),
  )
  const cases = [
    ['first', {}],
    ['rare', { q: 'LOAD06999' }],
    ['private-empty', { q: 'LOAD08001' }],
    ['literal', { q: '50%_' }],
    ['short-common', { q: 't' }],
  ]
  const report = { poolMax: 10, plans: [], repositoryPhases: [] }
  report.indexBytes = Number(
    (
      await client.unsafe(
        "SELECT coalesce(pg_relation_size(to_regclass('public.submissions_queue_search_idx')),0)::text AS bytes",
      )
    )[0].bytes,
  )
  try {
    for (const [name, query] of cases) {
      queries = []
      const result = await repository.reviewList(actors[0].id, { status: 'SUBMITTED', ...query })
      assert.equal(queries.length, 2, 'Capture authority + exact page SQL')
      const page = queries[1]
      const [plan] = await client.unsafe(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + page.sql,
        page.params,
      )
      report.plans.push({
        name,
        items: result.items.length,
        sqlSha256: createHash('sha256').update(page.sql).digest('hex'),
        plan: plan['QUERY PLAN'][0],
      })
    }
    if (report.indexBytes > 0 && cleanPending) {
      report.cleanedPendingPages = Number(
        (
          await client.unsafe(
            "SELECT gin_clean_pending_list('public.submissions_queue_search_idx'::regclass)::text AS pages",
          )
        )[0].pages,
      )
      queries = []
      await repository.reviewList(actors[0].id, { status: 'SUBMITTED', q: 'LOAD06999' })
      const page = queries[1]
      const [plan] = await client.unsafe(
        'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + page.sql,
        page.params,
      )
      report.afterPendingCleanup = plan['QUERY PLAN'][0]
    }
    capture = false
    for (const concurrency of [1, 10, 20]) {
      timings = []
      const start = performance.now(),
        cpuStart = process.cpuUsage()
      await Promise.all(
        actors.slice(0, concurrency).map(async (a) => {
          for (let repeat = 0; repeat < 5; repeat++)
            for (const [, query] of cases)
              await repository.reviewList(a.id, { status: 'SUBMITTED', ...query })
        }),
      )
      report.repositoryPhases.push({
        concurrency,
        requests: timings.length,
        elapsedMs: performance.now() - start,
        cpuMs: Object.values(process.cpuUsage(cpuStart)).reduce((a, b) => a + b, 0) / 1000,
        beginWait: stats(timings.map((r) => r.beginWaitMs)),
        body: stats(timings.map((r) => r.bodyMs)),
        total: stats(timings.map((r) => r.totalMs)),
      })
    }
    return report
  } finally {
    await client.end()
    await databaseClient.end()
  }
}
function stats(values) {
  const a = [...values].sort((x, y) => x - y)
  return {
    p50Ms: a[Math.ceil(a.length * 0.5) - 1],
    p95Ms: a[Math.ceil(a.length * 0.95) - 1],
    maxMs: a.at(-1),
  }
}

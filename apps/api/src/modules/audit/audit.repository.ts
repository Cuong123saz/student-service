import { and, desc, eq, lt } from 'drizzle-orm'

import { db } from '../../db/client.js'
import { auditLogs } from './audit.schema.js'
import type { AuditEventInput, ListAuditEventsInput, StoredAuditEvent } from './audit.types.js'

export interface AuditLogRepository {
  append(
    event: AuditEventInput & {
      occurredAt: Date
    },
  ): Promise<void>

  listRecent(input: ListAuditEventsInput): Promise<StoredAuditEvent[]>
}

export class DrizzleAuditLogRepository implements AuditLogRepository {
  async append(
    event: AuditEventInput & {
      occurredAt: Date
    },
  ): Promise<void> {
    await db.insert(auditLogs).values(event)
  }

  async listRecent(input: ListAuditEventsInput): Promise<StoredAuditEvent[]> {
    return db
      .select()
      .from(auditLogs)
      .where(
        and(
          input.before ? lt(auditLogs.occurredAt, input.before) : undefined,
          input.action ? eq(auditLogs.action, input.action) : undefined,
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(input.limit)
  }
}

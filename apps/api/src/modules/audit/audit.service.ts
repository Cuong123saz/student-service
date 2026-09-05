import type {
  FastifyBaseLogger,
} from 'fastify'

import type {
  AuditLogRepository,
} from './audit.repository.js'
import type {
  AuditEventInput,
  ListAuditEventsInput,
  StoredAuditEvent,
} from './audit.types.js'

export interface AuditRecorder {
  record(
    event: AuditEventInput,
  ): Promise<void>
}

export interface AuditLogUseCase
extends AuditRecorder {
  listRecent(
    input: ListAuditEventsInput,
  ): Promise<StoredAuditEvent[]>
}

export class AuditLogService
implements AuditLogUseCase {
  constructor(
    private readonly repository:
      AuditLogRepository,
    private readonly clock: () => Date =
      () => new Date(),
  ) {}

  async record(
    event: AuditEventInput,
  ): Promise<void> {
    await this.repository.append({
      ...event,
      occurredAt: this.clock(),
    })
  }

  async listRecent(
    input: ListAuditEventsInput,
  ): Promise<StoredAuditEvent[]> {
    return this.repository.listRecent(input)
  }
}

export async function recordAuditEventSafely(
  recorder: AuditRecorder,
  logger: FastifyBaseLogger,
  event: AuditEventInput,
): Promise<void> {
  try {
    await recorder.record(event)
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        auditAction: event.action,
        auditOutcome: event.outcome,
      },
      'Failed to persist audit event',
    )
  }
}

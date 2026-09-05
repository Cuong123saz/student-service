export type AuditActorType =
  | 'USER'
  | 'ANONYMOUS'
  | 'SYSTEM'

export type AuditOutcome =
  | 'SUCCESS'
  | 'FAILURE'

export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]

export type AuditMetadata =
  Record<string, AuditMetadataValue>

export type AuditState =
  Record<string, AuditMetadataValue>

export interface AuditEventInput {
  actorType: AuditActorType
  actorUserId: string | null
  actorUsername: string | null
  action: string
  resourceType: string
  resourceId: string | null
  outcome: AuditOutcome
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: AuditMetadata
  before?: AuditState | null
  after?: AuditState | null
}

export interface StoredAuditEvent
extends AuditEventInput {
  id: string
  occurredAt: Date
}

export interface ListAuditEventsInput {
  limit: number
  before?: Date
  action?: string
}

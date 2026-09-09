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
  | string[]

export type AuditState = Record<
  string,
  AuditMetadataValue
>

export interface AuditLogItem {
  id: string
  occurredAt: string
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
  metadata: AuditState
  before: AuditState | null
  after: AuditState | null
}

export interface AuditLogListResponse {
  auditLogs: AuditLogItem[]
}

export interface AuditLogQuery {
  limit?: number
  cursorBefore?: string
  action?: string
}

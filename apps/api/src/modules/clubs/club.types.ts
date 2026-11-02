/** ADR 0029: clubs (CLB) and club leader terms. */
export const clubStatuses = ['ACTIVE', 'SUSPENDED', 'DISSOLVED'] as const
export type ClubStatus = (typeof clubStatuses)[number]

export interface ClubSummary {
  id: string
  code: string
  name: string
  description: string
  status: ClubStatus
  statusReason: string | null
  revision: number
  activeLeaders: number
  isLeader: boolean
}
export interface ClubLeader {
  id: string
  userId: string
  username: string
  fullName: string
  validFrom: string
  validTo: string | null
  status: 'ACTIVE' | 'INACTIVE'
  endReason: string | null
}
export interface ClubDetail extends ClubSummary {
  createdAt: string
  dissolvedAt: string | null
  canManage: boolean
  leaders: ClubLeader[]
}
export interface ClubList {
  canManage: boolean
  items: ClubSummary[]
  truncated: boolean
}
export interface ClubInput {
  code: string
  name: string
  description: string
}
export interface ClubUpdateInput {
  expectedRevision: number
  name: string
  description: string
}
export interface ClubStatusInput {
  expectedRevision: number
  status: ClubStatus
  reason: string
}

/** Allowed status transitions; DISSOLVED is final. */
export const clubTransitions: Record<ClubStatus, readonly ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'DISSOLVED'],
  SUSPENDED: ['ACTIVE', 'DISSOLVED'],
  DISSOLVED: [],
}
export const clubStatusAuditActions = {
  ACTIVE: 'club.resumed',
  SUSPENDED: 'club.suspended',
  DISSOLVED: 'club.dissolved',
} as const satisfies Record<ClubStatus, string>
export const clubCodePattern = /^[A-Z0-9][A-Z0-9_-]{1,49}$/

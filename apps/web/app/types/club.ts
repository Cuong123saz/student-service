/** ADR 0029: clubs (CLB) and club leader terms. */
export type ClubStatus = 'ACTIVE' | 'SUSPENDED' | 'DISSOLVED'
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
export const clubStatusLabels: Record<ClubStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  SUSPENDED: 'Tạm dừng',
  DISSOLVED: 'Đã giải thể',
}
/** Mirrors the server: DISSOLVED is final. */
export const clubTransitions: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'DISSOLVED'],
  SUSPENDED: ['ACTIVE', 'DISSOLVED'],
  DISSOLVED: [],
}
export const clubTransitionLabels: Record<ClubStatus, string> = {
  ACTIVE: 'Mở lại CLB',
  SUSPENDED: 'Tạm dừng CLB',
  DISSOLVED: 'Giải thể CLB',
}

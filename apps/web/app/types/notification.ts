export interface PersonalNotification {
  id: string
  action: string
  title: string
  message: string
  createdAt: string
  readAt: string | null
  targetUrl: string
}
export interface NotificationPage {
  items: PersonalNotification[]
  nextCursor: string | null
  unreadCount: number
}

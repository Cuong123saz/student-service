export type Service = {
  id: number
  code: string
  name: string
  description: string
  processingDays: number
  status: 'ACTIVE' | 'INACTIVE'
}
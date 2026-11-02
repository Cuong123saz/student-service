import type { Activity, StudentActivity } from '../types/activity'
import { activityOwnerLabels } from '../types/activity'

/** Vietnamese date-time in Asia/Ho_Chi_Minh, independent of the browser time zone. */
export function formatActivityTime(iso: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
}
/** Value for <input type="datetime-local"> in Vietnam time (UTC+7, no DST). */
export function toLocalInput(iso: string) {
  if (!iso) return ''
  return new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 16)
}
/** Back from <input type="datetime-local"> (Vietnam time) to an ISO instant; '' stays ''. */
export function fromLocalInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return ''
  return new Date(Date.parse(value + ':00Z') - 7 * 3600000).toISOString()
}
export function activityOrganizer(
  a: Pick<Activity | StudentActivity, 'ownerType' | 'ownerClub' | 'delegatedClub'>,
) {
  const owner = a.ownerClub ? a.ownerClub.name : activityOwnerLabels[a.ownerType]
  return a.delegatedClub ? owner + ' · thực hiện: ' + a.delegatedClub.name : owner
}

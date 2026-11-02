import { SubmissionError } from '../submissions/submission.types.js'
import { groups, type Criterion, type Group } from '../training-points/training-points.types.js'

/** ADR 0033: per-period settings for training point suggestions from activities. */
export interface SuggestionSettings {
  window: { from: string; to: string }
  school: {
    group: Group
    full: number
    active: number
    minVoluntary: number
    fullWithoutMandatory: boolean
  }
  club: { group: Group; participant: number; organizer: number }
  volunteer: { group: Group; participant: number }
}
export interface SuggestionFacts {
  /** Ended, published mandatory SCHOOL activities the student belongs to or registered for. */
  mandatory: {
    activityId: string
    title: string
    certificateCode: string | null
    excused: boolean
  }[]
  /** ISSUED certificates of activities started inside the window (not cancelled). */
  certificates: {
    code: string
    activityId: string
    title: string
    kind: 'MANDATORY' | 'VOLUNTARY'
    category: 'SCHOOL' | 'CLUB_ACADEMIC' | 'VOLUNTEER'
  }[]
  /** Ended CLUB_ACADEMIC activities where the student is on the organising committee. */
  organizer: { activityId: string; title: string }[]
}
export type SuggestionRule =
  | 'SCHOOL_ACTIVE'
  | 'SCHOOL_FULL'
  | 'SCHOOL_MISSING'
  | 'CLUB_PARTICIPANT'
  | 'CLUB_ORGANIZER'
  | 'VOLUNTEER'
export interface SuggestionLine {
  group: Group
  rule: SuggestionRule
  points: number
  explanation: string
  certificateCodes: string[]
}
export interface Suggestion {
  window: { from: string; to: string }
  lines: SuggestionLine[]
  /** Per group, capped at the criterion maximum. */
  totals: Partial<Record<Group, number>>
  notice: string
}

const vn = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1) - 7 * 3600000).toISOString()
/** Semester windows in Vietnam time (ADR 0033 assumption): HK1 Aug–Jan, HK2 Feb–Jul, summer Jun–Aug. */
export function defaultWindow(academicYear: string, semester: '1' | '2' | 'SUMMER') {
  const start = Number(/^(\d{4})-\d{4}$/.exec(academicYear)?.[1] ?? NaN)
  if (!Number.isInteger(start))
    throw new SubmissionError(400, 'INVALID_ACTIVITY_SETTINGS', 'Năm học không hợp lệ.')
  if (semester === '1') return { from: vn(start, 8), to: vn(start + 1, 2) }
  if (semester === '2') return { from: vn(start + 1, 2), to: vn(start + 1, 8) }
  return { from: vn(start + 1, 6), to: vn(start + 1, 9) }
}
export function defaultSettings(
  academicYear: string,
  semester: '1' | '2' | 'SUMMER',
): SuggestionSettings {
  return {
    window: defaultWindow(academicYear, semester),
    school: { group: 'C', full: 3, active: 5, minVoluntary: 2, fullWithoutMandatory: true },
    club: { group: 'A', participant: 3, organizer: 2 },
    volunteer: { group: 'D', participant: 5 },
  }
}

const invalid = (m: string) => new SubmissionError(400, 'INVALID_ACTIVITY_SETTINGS', m)
const exact = (o: unknown, keys: string[]) =>
  !!o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  Object.keys(o).length === keys.length &&
  keys.every((k) => k in o)
/** Validates the shape and the limits against the period criteria; returns a normalised copy. */
export function validateSettings(input: unknown, criteria: Criterion[]): SuggestionSettings {
  const c = input as SuggestionSettings
  if (
    !exact(c, ['window', 'school', 'club', 'volunteer']) ||
    !exact(c.window, ['from', 'to']) ||
    !exact(c.school, ['group', 'full', 'active', 'minVoluntary', 'fullWithoutMandatory']) ||
    !exact(c.club, ['group', 'participant', 'organizer']) ||
    !exact(c.volunteer, ['group', 'participant'])
  )
    throw invalid('Thiết lập không đúng cấu trúc.')
  const max = (g: unknown) => {
    const found = criteria.find((x) => x.code === g)
    if (typeof g !== 'string' || !groups.includes(g as Group) || !found)
      throw invalid('Nhóm tiêu chí phải có trong bộ tiêu chí của đợt.')
    return found.maxPoints
  }
  const points = (v: unknown, limit: number) => {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > limit)
      throw invalid('Mức điểm phải là số nguyên từ 0 tới điểm tối đa của nhóm.')
    return v as number
  }
  const sm = max(c.school.group),
    cm = max(c.club.group),
    vm = max(c.volunteer.group)
  const from = Date.parse(c.window.from),
    to = Date.parse(c.window.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 400 * 86400000)
    throw invalid('Khoảng thời gian tính phải hợp lệ và không quá 400 ngày.')
  if (
    !Number.isInteger(c.school.minVoluntary) ||
    c.school.minVoluntary < 0 ||
    c.school.minVoluntary > 20
  )
    throw invalid('Số hoạt động tự chọn tối thiểu từ 0 đến 20.')
  if (typeof c.school.fullWithoutMandatory !== 'boolean')
    throw invalid('Thiết lập không đúng cấu trúc.')
  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    school: {
      group: c.school.group,
      full: points(c.school.full, sm),
      active: points(c.school.active, sm),
      minVoluntary: c.school.minVoluntary,
      fullWithoutMandatory: c.school.fullWithoutMandatory,
    },
    club: {
      group: c.club.group,
      participant: points(c.club.participant, cm),
      organizer: points(c.club.organizer, cm),
    },
    volunteer: { group: c.volunteer.group, participant: points(c.volunteer.participant, vm) },
  }
}

/** ADR 0033 rules; pure so that every edge case (B=0, excused, revoked) is unit-tested. */
export function computeSuggestion(
  s: SuggestionSettings,
  f: SuggestionFacts,
  criteria: Criterion[],
): Suggestion {
  const lines: SuggestionLine[] = []
  const missing = f.mandatory.filter((m) => !m.certificateCode && !m.excused)
  const full = f.mandatory.length ? missing.length === 0 : s.school.fullWithoutMandatory
  const voluntary = f.certificates.filter((c) => c.kind === 'VOLUNTARY' && c.category === 'SCHOOL')
  const schoolCodes = [
    ...f.mandatory.flatMap((m) => (m.certificateCode ? [m.certificateCode] : [])),
    ...voluntary.map((c) => c.code),
  ]
  const excused = f.mandatory.filter((m) => m.excused).length
  const base =
    `${f.mandatory.length - missing.length}/${f.mandatory.length} hoạt động bắt buộc` +
    (excused ? ` (${excused} hủy có lý do được chấp nhận)` : '')
  if (full && voluntary.length >= s.school.minVoluntary && s.school.active > 0)
    lines.push({
      group: s.school.group,
      rule: 'SCHOOL_ACTIVE',
      points: s.school.active,
      certificateCodes: schoolCodes,
      explanation: `Tích cực: ${base} và ${voluntary.length} hoạt động tự chọn (tối thiểu ${s.school.minVoluntary}).`,
    })
  else if (full)
    lines.push({
      group: s.school.group,
      rule: 'SCHOOL_FULL',
      points: s.school.full,
      certificateCodes: schoolCodes,
      explanation: f.mandatory.length
        ? `Đầy đủ: ${base}.`
        : 'Đầy đủ: kỳ này không có hoạt động bắt buộc thuộc đối tượng.',
    })
  else
    lines.push({
      group: s.school.group,
      rule: 'SCHOOL_MISSING',
      points: 0,
      certificateCodes: schoolCodes,
      explanation: `Chưa đủ: ${base}; còn thiếu ${missing.map((m) => m.title).join(', ')}.`,
    })
  const club = f.certificates.filter((c) => c.category === 'CLUB_ACADEMIC')
  if (club.length)
    lines.push({
      group: s.club.group,
      rule: 'CLUB_PARTICIPANT',
      points: s.club.participant,
      certificateCodes: club.map((c) => c.code),
      explanation: `Tham gia ${club.length} hoạt động CLB, học thuật hoặc ngoại khóa.`,
    })
  if (f.organizer.length)
    lines.push({
      group: s.club.group,
      rule: 'CLUB_ORGANIZER',
      points: s.club.organizer,
      certificateCodes: [],
      explanation: `Ban tổ chức: ${f.organizer.map((o) => o.title).join(', ')}.`,
    })
  const volunteer = f.certificates.filter((c) => c.category === 'VOLUNTEER')
  if (volunteer.length)
    lines.push({
      group: s.volunteer.group,
      rule: 'VOLUNTEER',
      points: s.volunteer.participant,
      certificateCodes: volunteer.map((c) => c.code),
      explanation: `Tham gia ${volunteer.length} hoạt động hiến máu, tình nguyện hoặc xã hội.`,
    })
  const totals: Partial<Record<Group, number>> = {}
  for (const l of lines) {
    const max = criteria.find((c) => c.code === l.group)?.maxPoints ?? 0
    totals[l.group] = Math.min(max, (totals[l.group] ?? 0) + l.points)
  }
  return {
    window: s.window,
    lines,
    totals,
    notice:
      'Gợi ý từ chứng nhận tham gia đang hiệu lực; cố vấn và khoa vẫn xét duyệt. Không tự sửa bản kê khai.',
  }
}

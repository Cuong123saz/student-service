import { describe, expect, it } from 'vitest'
import {
  activityOrganizer,
  applySuggestion,
  fromLocalInput,
  toLocalInput,
} from '../../app/utils/activity'
import { parseCohortList } from '../../app/utils/cohort'

describe('activity helpers (ADR 0030)', () => {
  it('converts datetime-local values as Vietnam time regardless of the browser zone', () => {
    expect(fromLocalInput('2026-11-20T08:00')).toBe('2026-11-20T01:00:00.000Z')
    expect(toLocalInput('2026-11-20T01:00:00.000Z')).toBe('2026-11-20T08:00')
    expect(fromLocalInput('')).toBe('')
    expect(fromLocalInput('20/11/2026 08:00')).toBe('')
    expect(toLocalInput('')).toBe('')
  })
  it('parses niên khóa lists into admission years (K = year − 2006)', () => {
    expect(parseCohortList('K15, k16 15')).toEqual([2021, 2022])
    expect(parseCohortList('')).toEqual([])
    expect(parseCohortList('K2021')).toBeNull()
    expect(parseCohortList('K0')).toBeNull()
    expect(parseCohortList('K95')).toBeNull()
  })
  it('names the organiser and the delegated club', () => {
    const club = { id: '1', code: 'DOIMAU', name: 'Đội Máu', status: 'ACTIVE' as const }
    expect(
      activityOrganizer({ ownerType: 'STUDENT_AFFAIRS', ownerClub: null, delegatedClub: null }),
    ).toBe('CTSV')
    expect(
      activityOrganizer({ ownerType: 'TRAINING_OFFICE', ownerClub: null, delegatedClub: club }),
    ).toBe('Phòng Đào tạo · thực hiện: Đội Máu')
    expect(activityOrganizer({ ownerType: 'CLUB', ownerClub: club, delegatedClub: null })).toBe(
      'Đội Máu',
    )
  })
})

describe('applySuggestion (ADR 0033)', () => {
  const criteria = [
    { code: 'A', maxPoints: 20 },
    { code: 'C', maxPoints: 20 },
    { code: 'D', maxPoints: 4 },
  ]
  const suggestion = {
    window: { from: '', to: '' },
    notice: '',
    totals: { A: 5, C: 3, D: 5 },
    lines: [
      {
        group: 'A' as const,
        rule: 'CLUB_PARTICIPANT' as const,
        points: 3,
        explanation: '',
        certificateCodes: ['CN-A1'],
      },
      {
        group: 'A' as const,
        rule: 'CLUB_ORGANIZER' as const,
        points: 2,
        explanation: '',
        certificateCodes: [],
      },
      {
        group: 'C' as const,
        rule: 'SCHOOL_FULL' as const,
        points: 3,
        explanation: '',
        certificateCodes: ['CN-C1', 'CN-C1'],
      },
      {
        group: 'D' as const,
        rule: 'VOLUNTEER' as const,
        points: 5,
        explanation: '',
        certificateCodes: ['CN-D1'],
      },
    ],
  }
  it('keeps the higher value, caps at the maximum and appends certificate codes once', () => {
    const before = {
      A: { points: 8, note: 'Học tốt' },
      C: { points: null, note: '' },
      D: { points: 0, note: '' },
    }
    const after = applySuggestion(before, suggestion, criteria)
    expect(after.A).toEqual({ points: 8, note: 'Học tốt\nChứng nhận ngoại khóa: CN-A1' })
    expect(after.C).toEqual({ points: 3, note: 'Chứng nhận ngoại khóa: CN-C1' })
    expect(after.D!.points).toBe(4)
    expect(before.C.points).toBeNull()
    expect(applySuggestion(after, suggestion, criteria)).toEqual(after)
  })
})

import { describe, expect, it } from 'vitest'
import { activityOrganizer, fromLocalInput, toLocalInput } from '../../app/utils/activity'
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

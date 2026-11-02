import assert from 'node:assert/strict'
import { test } from 'node:test'
import { academyCriteria } from '../training-points/training-points.types.js'
import { SubmissionError } from '../submissions/submission.types.js'
import {
  computeSuggestion,
  defaultSettings,
  defaultWindow,
  validateSettings,
  type SuggestionFacts,
} from './activity-suggestion.js'

const criteria = academyCriteria()
const settings = defaultSettings('2026-2027', '1')
const cert = (
  code: string,
  kind: 'MANDATORY' | 'VOLUNTARY',
  category: 'SCHOOL' | 'CLUB_ACADEMIC' | 'VOLUNTEER',
) => ({
  code,
  activityId: code,
  title: code,
  kind,
  category,
})
const facts = (over: Partial<SuggestionFacts> = {}): SuggestionFacts => ({
  mandatory: [],
  certificates: [],
  organizer: [],
  ...over,
})
const school = (f: SuggestionFacts, s = settings) => computeSuggestion(s, f, criteria).lines[0]!

test('semester windows follow Vietnam time: HK1 Aug–Jan, HK2 Feb–Jul', () => {
  assert.deepEqual(defaultWindow('2026-2027', '1'), {
    from: '2026-07-31T17:00:00.000Z',
    to: '2027-01-31T17:00:00.000Z',
  })
  assert.deepEqual(defaultWindow('2026-2027', '2'), {
    from: '2027-01-31T17:00:00.000Z',
    to: '2027-07-31T17:00:00.000Z',
  })
})

test('school: all mandatory → +3; plus 2 voluntary → +5; missing one → 0', () => {
  const two = [
    { activityId: 'm1', title: 'Sinh hoạt công dân', certificateCode: 'CN-M1', excused: false },
    { activityId: 'm2', title: 'Hội thảo', certificateCode: 'CN-M2', excused: false },
  ]
  assert.equal(school(facts({ mandatory: two })).points, 3)
  assert.equal(school(facts({ mandatory: two })).rule, 'SCHOOL_FULL')
  const active = school(
    facts({
      mandatory: two,
      certificates: [cert('V1', 'VOLUNTARY', 'SCHOOL'), cert('V2', 'VOLUNTARY', 'SCHOOL')],
    }),
  )
  assert.deepEqual([active.rule, active.points], ['SCHOOL_ACTIVE', 5])
  assert.deepEqual(active.certificateCodes, ['CN-M1', 'CN-M2', 'V1', 'V2'])
  // One voluntary is not enough for "tích cực" with the default minimum of 2.
  assert.equal(
    school(facts({ mandatory: two, certificates: [cert('V1', 'VOLUNTARY', 'SCHOOL')] })).points,
    3,
  )
  const missing = school(facts({ mandatory: [two[0]!, { ...two[1]!, certificateCode: null }] }))
  assert.deepEqual([missing.rule, missing.points], ['SCHOOL_MISSING', 0])
  assert.match(missing.explanation, /Hội thảo/)
  // Club voluntary activities in other categories never count towards "tích cực".
  assert.equal(
    school(
      facts({
        mandatory: two,
        certificates: [
          cert('C1', 'VOLUNTARY', 'CLUB_ACADEMIC'),
          cert('C2', 'VOLUNTARY', 'VOLUNTEER'),
        ],
      }),
    ).points,
    3,
  )
})

test('excused cancellations count; B=0 follows the period setting', () => {
  const excused = school(
    facts({ mandatory: [{ activityId: 'm', title: 'x', certificateCode: null, excused: true }] }),
  )
  assert.equal(excused.points, 3)
  assert.match(excused.explanation, /hủy có lý do/)
  assert.equal(school(facts()).points, 3, 'owner decision: B=0 still gives +3 by default')
  const strict = { ...settings, school: { ...settings.school, fullWithoutMandatory: false } }
  assert.equal(school(facts(), strict).points, 0)
})

test('club, organiser and volunteer lines; group totals capped at the criterion maximum', () => {
  const r = computeSuggestion(
    settings,
    facts({
      certificates: [
        cert('C1', 'VOLUNTARY', 'CLUB_ACADEMIC'),
        cert('D1', 'VOLUNTARY', 'VOLUNTEER'),
      ],
      organizer: [{ activityId: 'o', title: 'Ngày hội CLB' }],
    }),
    criteria,
  )
  assert.deepEqual(
    r.lines.map((l) => [l.rule, l.group, l.points]),
    [
      ['SCHOOL_FULL', 'C', 3],
      ['CLUB_PARTICIPANT', 'A', 3],
      ['CLUB_ORGANIZER', 'A', 2],
      ['VOLUNTEER', 'D', 5],
    ],
  )
  assert.deepEqual(r.totals, { C: 3, A: 5, D: 5 })
  const tight = criteria.map((c) => (c.code === 'A' ? { ...c, maxPoints: 4 } : c))
  assert.equal(
    computeSuggestion(
      settings,
      facts({
        certificates: [cert('C1', 'VOLUNTARY', 'CLUB_ACADEMIC')],
        organizer: [{ activityId: 'o', title: 't' }],
      }),
      tight,
    ).totals.A,
    4,
  )
})

test('settings are validated against the period criteria', () => {
  assert.deepEqual(validateSettings(structuredClone(settings), criteria), settings)
  const bad = (mutate: (s: typeof settings & Record<string, unknown>) => void) => {
    const s = structuredClone(settings) as typeof settings & Record<string, unknown>
    mutate(s)
    assert.throws(
      () => validateSettings(s, criteria),
      (e) => e instanceof SubmissionError && e.code === 'INVALID_ACTIVITY_SETTINGS',
    )
  }
  bad((s) => (s.school.active = 21))
  bad((s) => (s.volunteer.participant = 26 + 100))
  bad((s) => (s.club.group = 'F' as never))
  bad((s) => (s.school.minVoluntary = -1))
  bad((s) => (s.window = { from: s.window.to, to: s.window.from }))
  bad((s) => (s.extra = 1))
  bad((s) => ((s.school as Record<string, unknown>).bonus = 1))
  assert.throws(
    () =>
      validateSettings(
        settings,
        criteria.filter((c) => c.code !== 'D'),
      ),
    /Nhóm tiêu chí/,
  )
})

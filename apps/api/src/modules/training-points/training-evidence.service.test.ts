import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { TrainingPointService, type TrainingPointStore } from './training-points.service.js'
import {
  TrainingReviewService,
  type TrainingReviewStore,
} from '../training-reviews/training-review.service.js'
import { SubmissionError } from '../submissions/submission.types.js'
import type { EvidenceStorage } from '../submissions/submission.storage.js'
import type { ReviewDetail } from '../training-reviews/training-review.types.js'
const bytes = Buffer.from('synthetic evidence')
const proof = {
  storageKey: 'key',
  name: 'proof.pdf',
  mimeType: 'application/pdf',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}
const unused = () => {
  throw new Error('Unexpected repository call')
}
function fixture() {
  let reads = 0,
    writes = 0
  const storage: EvidenceStorage = {
    put: unused,
    remove: unused,
    read: async () => {
      reads++
      return bytes
    },
  }
  const detail: ReviewDetail = {
    id: 'declaration',
    periodId: 'period',
    period: {
      name: 'Synthetic',
      academicYear: '2026-2027',
      semester: '1',
      policyLabel: 'Synthetic',
      criteria: [],
    },
    student: { fullName: 'Synthetic', studentCode: 'TEST', classCode: 'TEST', facultyCode: 'TEST' },
    answers: {},
    totalPoints: 0,
    submittedAt: '',
    declarationSha256: '',
    files: [{ ...proof, id: 'proof', criterion: 'A', signatureStatus: 'NOT_CHECKED' }],
    state: 'WAITING_ADVISOR',
    revision: 0,
    decisions: [],
    historyTruncated: false,
    canAdvisorSign: true,
    canFacultyDecide: false,
    canMonitorConfirm: false,
    canAdvisorBypass: false,
  }
  const points: TrainingPointStore = {
    catalog: unused,
    periods: unused,
    periodDetail: unused,
    createPeriod: unused,
    changePeriod: unused,
    start: unused,
    detail: unused,
    save: unused,
    submit: unused,
    addFile: unused,
    removeFile: unused,
    file: async () => ({
      id: 'proof',
      declaration_id: 'declaration',
      criterion: 'A',
      storage_key: proof.storageKey,
      name: proof.name,
      mime_type: proof.mimeType,
      size: proof.size,
      sha256: proof.sha256,
      signature_status: 'NOT_CHECKED',
      input_revision: 1,
      removed_at: null,
    }),
  }
  const reviews: TrainingReviewStore = {
    periods: unused,
    queue: unused,
    roster: unused,
    appointMonitor: unused,
    monitorAudit: unused,
    detail: async () => detail,
    file: async () => proof,
    act: async () => {
      writes++
      return detail
    },
  }
  return { storage, points, reviews, reads: () => reads, writes: () => writes }
}
for (const kind of ['points', 'review'] as const) {
  const prefix = kind === 'points' ? 'TRAINING_FILE' : 'TRAINING_REVIEW_FILE'
  const make = (f: ReturnType<typeof fixture>) =>
    kind === 'points'
      ? new TrainingPointService(f.points, f.storage)
      : new TrainingReviewService(f.reviews, f.storage)
  test(kind + ' service runs with injected storage and no environment or database', async () => {
    const f = fixture()
    assert.deepEqual((await make(f).download('user', 'declaration', 'proof')).bytes, bytes)
    assert.equal(f.reads(), 1)
  })
  test(kind + ' service reports missing and corrupt evidence with module error codes', async () => {
    const f = fixture(),
      service = make(f)
    f.storage.read = async () => {
      throw new Error('private/path')
    }
    await assert.rejects(
      service.download('user', 'declaration', 'proof'),
      (e) =>
        e instanceof SubmissionError && e.statusCode === 409 && e.code === prefix + '_UNAVAILABLE',
    )
    f.storage.read = async () => Buffer.alloc(bytes.length)
    await assert.rejects(
      service.download('user', 'declaration', 'proof'),
      (e) =>
        e instanceof SubmissionError && e.statusCode === 409 && e.code === prefix + '_INTEGRITY',
    )
  })
  test(kind + ' service never masks access denial or reads denied files', async () => {
    const f = fixture(),
      denied = new SubmissionError(404, 'NOT_FOUND', 'Not found')
    f.points.file = f.reviews.file = async () => {
      throw denied
    }
    await assert.rejects(make(f).download('user', 'declaration', 'proof'), (e) => e === denied)
    assert.equal(f.reads(), 0)
  })
}
test('unavailable review evidence prevents a decision write', async () => {
  const f = fixture()
  f.storage.read = async () => {
    throw new Error('Missing')
  }
  await assert.rejects(
    new TrainingReviewService(f.reviews, f.storage).act('user', 'declaration', 'ADVISOR_SIGNED', {
      expectedRevision: 0,
      requestId: 'request',
      confirmed: true,
      comment: 'Synthetic',
    }),
    (e) => e instanceof SubmissionError && e.statusCode === 409,
  )
  assert.equal(f.writes(), 0)
})

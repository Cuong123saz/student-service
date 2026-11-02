import { SubmissionError } from '../submissions/submission.types.js'
import { groups } from '../training-points/training-points.types.js'
import { trainingExportMaxRows, type TrainingExportSnapshot } from './training-export.types.js'

export const trainingExportIntegrityError = () =>
  new SubmissionError(
    409,
    'TRAINING_EXPORT_INTEGRITY',
    'Dữ liệu xét duyệt không nhất quán. Chưa thể xuất.',
  )

/**
 * Every export format renders the same snapshot contract. Reject inconsistent DTOs before any
 * byte is produced instead of letting one format silently disagree with another.
 */
export function assertTrainingExportSnapshot(s: TrainingExportSnapshot): void {
  if (s.rows.length > trainingExportMaxRows)
    throw new SubmissionError(
      422,
      'TRAINING_EXPORT_TOO_LARGE',
      'Một lần xuất tối đa 1.000 bản đã duyệt.',
    )
  const total = s.rows.reduce((n, r) => n + r.approvedPoints, 0)
  const average = s.rows.length ? Math.round((total * 100) / s.rows.length) / 100 : null
  if (
    s.summary.approved !== s.rows.length ||
    s.summary.approvedTotalPoints !== total ||
    s.summary.approvedAveragePoints !== average
  )
    throw trainingExportIntegrityError()
  for (const r of s.rows) {
    const values = groups.map((g) => r.approvedAnswers[g]?.points)
    if (
      values.some(
        (v, i) =>
          !Number.isInteger(v) ||
          v! < 0 ||
          v! > (s.period.criteria.find((c) => c.code === groups[i])?.maxPoints ?? -1),
      ) ||
      values.reduce<number>((n, v) => n + (v ?? 0), 0) !== r.approvedPoints ||
      !Number.isInteger(r.selfPoints) ||
      r.selfPoints < 0 ||
      r.selfPoints > 100
    )
      throw trainingExportIntegrityError()
  }
}

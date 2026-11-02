/**
 * ADR 0026: provisional classification from the faculty-approved total.
 * Standard bands accepted by the project owner as the current reference; verify against the
 * Học viện regulation. Changing a band requires a new version. Disciplinary downgrades
 * (khiển trách −1 mức, cảnh cáo −2 mức) are NOT applied: the system has no discipline data.
 */
export const trainingClassificationVersion = 'classification-standard-v1'

export const trainingClassificationLevels = Object.freeze([
  { key: 'EXCELLENT', label: 'Xuất sắc', min: 90 },
  { key: 'GOOD', label: 'Tốt', min: 80 },
  { key: 'FAIRLY_GOOD', label: 'Khá', min: 65 },
  { key: 'AVERAGE', label: 'Trung bình', min: 50 },
  { key: 'WEAK', label: 'Yếu', min: 35 },
  { key: 'POOR', label: 'Kém', min: 0 },
] as const)

export type TrainingClassificationKey = (typeof trainingClassificationLevels)[number]['key']

export interface TrainingClassificationInfo {
  status: 'PROVISIONAL'
  version: typeof trainingClassificationVersion
}
export const provisionalClassification: TrainingClassificationInfo = Object.freeze({
  status: 'PROVISIONAL',
  version: trainingClassificationVersion,
})

export function classifyTrainingPoints(total: number) {
  if (!Number.isInteger(total) || total < 0 || total > 100)
    throw new Error('INVALID_TRAINING_TOTAL')
  return trainingClassificationLevels.find((level) => total >= level.min)!
}

/** Counts per level, in band order, including zero counts. */
export function countTrainingClassifications(totals: readonly number[]) {
  const counts = new Map<TrainingClassificationKey, number>(
    trainingClassificationLevels.map((l) => [l.key, 0]),
  )
  for (const total of totals) {
    const key = classifyTrainingPoints(total).key
    counts.set(key, counts.get(key)! + 1)
  }
  return trainingClassificationLevels.map((l) => ({ ...l, count: counts.get(l.key)! }))
}

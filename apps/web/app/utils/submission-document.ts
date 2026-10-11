export type DocumentFormat = 'docx' | 'pdf' | 'zip'
export function submissionDocumentUrl(
  apiBase: string,
  reviewPortal: 'user' | 'admin' | undefined,
  id: string,
  roundNumber: number,
  format: DocumentFormat,
) {
  return (
    apiBase.replace(/\/$/, '') +
    '/api/v1/' +
    (reviewPortal ?? 'user') +
    (reviewPortal ? '/review-submissions/' : '/submissions/') +
    encodeURIComponent(id) +
    '/rounds/' +
    roundNumber +
    (format === 'zip' ? '/bundle' : '/documents/' + format)
  )
}

export interface SubmissionDocumentState {
  format: 'docx' | 'pdf'
  state: 'NOT_STARTED' | 'RUNNING' | 'WAITING' | 'EXHAUSTED' | 'READY'
  attempts: number
  attemptLimit: number
  attemptId: string | null
  errorCode: string | null
  nextAttemptAt: string | null
  retryAllowed: boolean
  remainingAuthorizations: number
}
export interface SubmissionDocumentStatus {
  enabled: boolean
  documents: SubmissionDocumentState[]
}
export function submissionDocumentStatusUrl(
  apiBase: string,
  portal: 'user' | 'admin' | undefined,
  id: string,
  round: number,
) {
  return submissionDocumentUrl(apiBase, portal, id, round, 'docx').replace(
    /\/documents\/docx$/,
    '/document-status',
  )
}

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

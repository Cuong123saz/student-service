import { SubmissionError } from './submission.types.js'

export interface DeclarationTemplateBinding {
  id: string
  sha256: string
  bindingSource: 'SUBMITTED' | 'LEGACY_V1'
}
// A published template is never replaced. New layouts get a new ID and catalog entry.
export const submissionDocumentTemplate = Object.freeze({
  id: 'submission-summary-v1',
  sha256: '9074a0b961cf66b625d4339c4473a42c7bfc3d981816f821fa78552c7fae8ca2',
})
const catalog = Object.freeze({
  'submission-summary-v1': Object.freeze({
    ...submissionDocumentTemplate,
    fileName: 'submission-summary-v1.docx',
  }),
})
export function newDeclarationTemplateBinding(): DeclarationTemplateBinding {
  return { ...submissionDocumentTemplate, bindingSource: 'SUBMITTED' }
}
export function resolveDeclarationTemplate(binding: DeclarationTemplateBinding) {
  if (
    !binding ||
    typeof binding.id !== 'string' ||
    !Object.hasOwn(catalog, binding.id) ||
    !['SUBMITTED', 'LEGACY_V1'].includes(binding.bindingSource)
  )
    throw unavailableTemplate()
  const template = catalog[binding.id as keyof typeof catalog]
  if (binding.sha256 !== template.sha256) throw unavailableTemplate()
  return template
}
export function unavailableTemplate() {
  return new SubmissionError(
    503,
    'DOCUMENT_TEMPLATE_UNAVAILABLE',
    'Mẫu phiếu chưa sẵn sàng hoặc không đúng phiên bản. Vui lòng liên hệ đơn vị xử lý; hồ sơ đã gửi vẫn được giữ nguyên.',
  )
}

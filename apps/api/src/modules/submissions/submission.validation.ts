import { createHash } from 'node:crypto'
import type { PublicProcedure, ValidationIssue } from '../procedures/procedure.contract.js'
import { SubmissionError, type DraftValues, type EvidenceView } from './submission.types.js'
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export function validateAnswers(
  procedure: PublicProcedure,
  values: DraftValues,
  includeProfile = false,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const key of Object.keys(values)) {
    const field = procedure.fields.find((f) => f.key === key)
    const path = 'values.' + key
    const value = values[key]
    if (!field) {
      issues.push({ path, message: 'Trường này không có trong biểu mẫu.' })
      continue
    }
    if (field.source === 'PROFILE' && !includeProfile) {
      issues.push({ path, message: 'Thông tin hồ sơ do hệ thống điền.' })
      continue
    }
    if (value === null || value === '') continue
    let valid: boolean
    if (field.type === 'NUMBER') valid = typeof value === 'number' && Number.isFinite(value)
    else if (field.type === 'BOOLEAN') valid = typeof value === 'boolean'
    else if (typeof value !== 'string') valid = false
    else if (field.type === 'DATE') {
      const date = new Date(value + 'T00:00:00.000Z')
      valid =
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    } else if (field.type === 'SELECT') valid = field.options.some((o) => o.value === value)
    else valid = value.length <= field.maxLength
    if (!valid)
      issues.push({ path, message: 'Giá trị không đúng kiểu, lựa chọn hoặc giới hạn của trường.' })
  }
  return issues
}
export function completionIssues(
  procedure: PublicProcedure,
  values: DraftValues,
  files: EvidenceView[],
): ValidationIssue[] {
  return [
    ...procedure.fields
      .filter(
        (f) =>
          f.required &&
          (!Object.hasOwn(values, f.key) ||
            values[f.key] === undefined ||
            values[f.key] === null ||
            (typeof values[f.key] === 'string' && !String(values[f.key]).trim())),
      )
      .map((f) => ({
        path: 'values.' + f.key,
        message: 'Cần bổ sung ' + f.label.toLowerCase() + '.',
      })),
    ...procedure.attachments
      .filter((a) => a.required && !files.some((f) => f.attachmentKey === a.key))
      .map((a) => ({
        path: 'attachments.' + a.key,
        message: 'Cần bổ sung ' + a.label.toLowerCase() + '.',
      })),
  ]
}
export function inspectEvidence(bytes: Buffer, suppliedName: string, suppliedMime: string) {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new SubmissionError(413, 'FILE_SIZE', 'Tệp phải có nội dung và không vượt quá 5 MiB.')
  const name = Array.from(suppliedName.split(/[\\/]/).pop() ?? '')
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .trim()
  if (!name || name.length > 200)
    throw new SubmissionError(422, 'FILE_NAME', 'Tên tệp không hợp lệ hoặc dài quá 200 ký tự.')
  let mimeType: string | null = null
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') mimeType = 'application/pdf'
  else if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  )
    mimeType = 'image/png'
  else if (
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    mimeType = 'image/jpeg'
  const extension = name.split('.').pop()?.toLowerCase()
  const extensions: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
  }
  if (!mimeType || suppliedMime !== mimeType || !extensions[mimeType]?.includes(extension ?? ''))
    throw new SubmissionError(
      422,
      'FILE_FORMAT',
      'Chỉ nhận PDF, PNG hoặc JPEG có tên, loại và nội dung phù hợp.',
    )
  return {
    name,
    mimeType,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

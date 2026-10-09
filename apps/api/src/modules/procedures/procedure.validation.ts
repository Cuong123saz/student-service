import type { ProcedureConfig, ValidationIssue } from './procedure.contract.js'
export function validateProcedureConfig(config: ProcedureConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })
  const fieldKeys = new Set<string>()
  config.fields.forEach((field, i) => {
    if (!field.label.trim()) add('fields.' + i + '.label', 'Tên trường không được để trống.')
    if (fieldKeys.has(field.key)) add('fields.' + i + '.key', 'Mã trường đã tồn tại.')
    fieldKeys.add(field.key)
    if (field.source === 'PROFILE' && (!field.profileKey || field.type !== 'TEXT')) {
      add('fields.' + i + '.source', 'Trường hồ sơ phải chọn dữ liệu tự điền và kiểu văn bản.')
    }
    if (field.source === 'STUDENT_INPUT' && field.profileKey !== null) {
      add('fields.' + i + '.source', 'Trường sinh viên khai không được gắn dữ liệu hồ sơ.')
    }
    if (field.type === 'SELECT') {
      if (field.options.length === 0) add('fields.' + i + '.options', 'Cần ít nhất một lựa chọn.')
      const values = new Set<string>()
      field.options.forEach((option) => {
        if (!option.value.trim() || !option.label.trim() || values.has(option.value)) {
          add('fields.' + i + '.options', 'Lựa chọn cần mã/tên hợp lệ và không trùng mã.')
        }
        values.add(option.value)
      })
    } else if (field.options.length > 0)
      add('fields.' + i + '.options', 'Chỉ trường danh sách lựa chọn được khai báo lựa chọn.')
  })
  const keys = new Set<string>()
  config.attachments.forEach((attachment, i) => {
    if (!attachment.label.trim())
      add('attachments.' + i + '.label', 'Tên minh chứng không được trống.')
    if (keys.has(attachment.key)) add('attachments.' + i + '.key', 'Mã minh chứng đã tồn tại.')
    keys.add(attachment.key)
    if (attachment.required && attachment.maxBytes > config.maxTotalAttachmentBytes) {
      add('attachments.' + i + '.maxBytes', 'Giới hạn một file vượt tổng dung lượng hồ sơ.')
    }
  })
  if (!config.contactInstructions.trim())
    add('contactInstructions', 'Cần hướng dẫn sinh viên liên hệ hoặc thực hiện thủ tục.')
  return issues
}
export function defaultProcedureConfig(unitId: string): ProcedureConfig {
  return {
    processingMode: 'OFFLINE',
    processingUnitId: unitId,
    processorUserId: null,
    contactInstructions:
      'Sinh viên liên hệ trực tiếp đơn vị xử lý để được hướng dẫn thực hiện thủ tục.',
    fields: [
      {
        key: 'studentCode',
        label: 'Mã sinh viên',
        type: 'TEXT',
        source: 'PROFILE',
        profileKey: 'studentCode',
        required: true,
        maxLength: 50,
        options: [],
      },
      {
        key: 'fullName',
        label: 'Họ và tên',
        type: 'TEXT',
        source: 'PROFILE',
        profileKey: 'fullName',
        required: true,
        maxLength: 255,
        options: [],
      },
    ],
    attachments: [],
    maxTotalAttachmentBytes: 20 * 1024 * 1024,
  }
}

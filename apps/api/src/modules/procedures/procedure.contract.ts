import { Type, type Static } from '@sinclair/typebox'
const enumeration = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)))
export const fieldSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-zA-Z0-9_]*$' }),
    label: Type.String({ minLength: 1, maxLength: 255 }),
    type: enumeration(['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const),
    source: enumeration(['STUDENT_INPUT', 'PROFILE'] as const),
    profileKey: Type.Union([
      enumeration(['studentCode', 'fullName', 'classCode', 'facultyCode'] as const),
      Type.Null(),
    ]),
    required: Type.Boolean(),
    maxLength: Type.Integer({ minimum: 1, maximum: 2000 }),
    options: Type.Array(
      Type.Object(
        {
          value: Type.String({ minLength: 1, maxLength: 100 }),
          label: Type.String({ minLength: 1, maxLength: 255 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { additionalProperties: false },
)
const attachmentSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z][a-zA-Z0-9_]*$' }),
    label: Type.String({ minLength: 1, maxLength: 255 }),
    required: Type.Boolean(),
    mimeTypes: Type.Array(enumeration(['application/pdf', 'image/png', 'image/jpeg'] as const), {
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    }),
    maxFiles: Type.Integer({ minimum: 1, maximum: 3 }),
    maxBytes: Type.Integer({ minimum: 1, maximum: 5 * 1024 * 1024 }),
  },
  { additionalProperties: false },
)
export const procedureConfigSchema = Type.Object(
  {
    processingMode: enumeration(['OFFLINE', 'ONLINE', 'HYBRID'] as const),
    processingUnitId: Type.String({ format: 'uuid' }),
    processorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    contactInstructions: Type.String({ maxLength: 2000 }),
    fields: Type.Array(fieldSchema, { maxItems: 50 }),
    attachments: Type.Array(attachmentSchema, { maxItems: 5 }),
    maxTotalAttachmentBytes: Type.Integer({ minimum: 1, maximum: 20 * 1024 * 1024 }),
  },
  { additionalProperties: false },
)
export type ProcedureConfig = Static<typeof procedureConfigSchema>
export type ProcedureField = Static<typeof fieldSchema>
export interface ValidationIssue {
  path: string
  message: string
}
export interface ProcedureVersion {
  id: string
  serviceId: number
  ownerUnitId: string
  versionNumber: number
  revision: number
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED'
  config: ProcedureConfig
  publishedAt: Date | null
}
export interface ProcedureCatalog {
  services: { id: number; code: string; name: string; status: string }[]
  units: { id: string; code: string; name: string }[]
  reviewers: { id: string; name: string; unitId: string | null }[]
  canCreate: boolean
}
export interface ProcedureActor {
  userId: string
  username: string
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
}
export interface CreateProcedureInput {
  serviceId: number
  ownerUnitId: string
  cloneVersionId: string | null
}
export interface UpdateProcedureInput {
  expectedRevision: number
  config: ProcedureConfig
}
export interface PublicProcedure {
  versionId: string
  versionNumber: number
  processingMode: ProcedureConfig['processingMode']
  processingUnitName: string
  contactInstructions: string
  fields: ProcedureField[]
  attachments: ProcedureConfig['attachments']
  maxTotalAttachmentBytes: number
}

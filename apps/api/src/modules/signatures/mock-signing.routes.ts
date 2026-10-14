import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import type { SubmissionService } from '../submissions/submission.service.js'
import { SubmissionError } from '../submissions/submission.types.js'
import {
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import type { MockSignInput, MockVerifyInput } from './mock-signing.js'
export function registerMockSigningRoutes(
  app: FastifyInstance,
  service: SubmissionService,
  portal: 'user' | 'admin',
  review: boolean,
) {
  const base = (review ? '/review-submissions' : '/submissions') + '/:id/rounds/:roundNumber'
  const uuid = Type.String({ format: 'uuid' })
  const roundParams = Type.Object(
    { id: uuid, roundNumber: Type.Integer({ minimum: 1, maximum: 2147483647 }) },
    { additionalProperties: false },
  )
  const params = Type.Object(
    { ...roundParams.properties, format: Type.Union([Type.Literal('docx'), Type.Literal('pdf')]) },
    { additionalProperties: false },
  )
  app.get<{ Params: { id: string; roundNumber: number } }>(
    base + '/mock-signatures',
    {
      preHandler: [requireSubmissionSession(portal, !review)],
      schema: { params: roundParams },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) =>
      executeSubmission(req, reply, async () => {
        reply.header('Cache-Control', 'private, no-store')
        return service.mockSignatureStatus(
          submissionActor(req).userId,
          req.params.id,
          req.params.roundNumber,
          review,
        )
      }),
  )
  const strict = (fields: string[]) => async (req: { body: unknown }) => {
    if (
      req.body &&
      typeof req.body === 'object' &&
      Object.keys(req.body).some((k) => !fields.includes(k))
    )
      throw new SubmissionError(
        400,
        'INVALID_MOCK_SIGNATURE_INPUT',
        'Thông tin mô phỏng có trường không hợp lệ.',
      )
  }
  if (review)
    app.post<{
      Params: { id: string; roundNumber: number; format: 'docx' | 'pdf' }
      Body: MockSignInput
    }>(
      base + '/documents/:format/mock-sign',
      {
        preHandler: [requireSubmissionSession(portal), submissionOrigin],
        preValidation: strict(['requestId', 'expectedRevision']),
        bodyLimit: 2048,
        schema: {
          params,
          body: Type.Object(
            {
              requestId: uuid,
              expectedRevision: Type.Integer({ minimum: 1, maximum: 2147483647 }),
            },
            { additionalProperties: false },
          ),
        },
        config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
      },
      async (req, reply) =>
        executeSubmission(req, reply, async () => {
          reply.header('Cache-Control', 'private, no-store')
          return service.mockSignatureSign(
            submissionActor(req).userId,
            req.params.id,
            req.params.roundNumber,
            req.params.format,
            req.body,
          )
        }),
    )
  app.post<{
    Params: { id: string; roundNumber: number; format: 'docx' | 'pdf' }
    Body: MockVerifyInput
  }>(
    base + '/documents/:format/mock-verify',
    {
      preHandler: [requireSubmissionSession(portal, !review), submissionOrigin],
      preValidation: strict(['requestId', 'receiptId']),
      bodyLimit: 2048,
      schema: {
        params,
        body: Type.Object({ requestId: uuid, receiptId: uuid }, { additionalProperties: false }),
      },
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    },
    async (req, reply) =>
      executeSubmission(req, reply, async () => {
        reply.header('Cache-Control', 'private, no-store')
        return service.mockSignatureVerify(
          submissionActor(req).userId,
          req.params.id,
          req.params.roundNumber,
          req.params.format,
          req.body,
          review,
        )
      }),
  )
}

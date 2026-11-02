import { Type } from '@sinclair/typebox'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  configureSubmissionErrors,
  executeSubmission,
  requireSubmissionSession,
  submissionActor,
  submissionOrigin,
} from '../submissions/submission.http.js'
import { SubmissionError, type SubmissionActor } from '../submissions/submission.types.js'
import type { TrainingExportFile, TrainingExportUseCase } from './training-export.service.js'

type Params = { Params: { id: string } }
const exportOptions = {
  preHandler: [requireSubmissionSession('user'), submissionOrigin],
  schema: {
    body: Type.Object({}, { additionalProperties: false }),
    params: Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
  },
  preValidation: async (request: FastifyRequest) => {
    if (
      Object.keys(request.query as object).length ||
      (request.body && typeof request.body === 'object' && Object.keys(request.body).length)
    )
      throw new SubmissionError(
        400,
        'INVALID_TRAINING_EXPORT',
        'Không nhận bộ lọc hoặc định dạng tùy ý khi xuất.',
      )
  },
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
}

function sendFile(reply: FastifyReply, file: TrainingExportFile, fallbackName: string) {
  reply.header('X-Export-Snapshot-Id', file.snapshotId).header('X-Export-Sha256', file.sha256)
  if (file.templateVersion) reply.header('X-Export-Template-Version', file.templateVersion)
  if (file.sourceDocxSha256) reply.header('X-Export-Source-Docx-Sha256', file.sourceDocxSha256)
  if (file.manifestSha256) reply.header('X-Export-Manifest-Sha256', file.manifestSha256)
  return reply
    .type(file.mimeType)
    .header(
      'Content-Disposition',
      `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    )
    .header('X-Content-Type-Options', 'nosniff')
    .send(file.bytes)
}

export async function trainingExportRoutes(
  app: FastifyInstance,
  options: { trainingExportService: TrainingExportUseCase },
) {
  configureSubmissionErrors(app)
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
  })
  const route = (
    suffix: string,
    fallbackName: string,
    download: (actor: SubmissionActor, periodId: string) => Promise<TrainingExportFile>,
  ) =>
    app.post<Params>(`/training-reviews/periods/:id/${suffix}`, exportOptions, (request, reply) =>
      executeSubmission(request, reply, async () =>
        sendFile(
          reply,
          await download(submissionActor(request), request.params.id.toLowerCase()),
          fallbackName,
        ),
      ),
    )
  const service = options.trainingExportService
  route('export.xlsx', 'training-points.xlsx', (actor, id) => service.downloadXlsx(actor, id))
  route('minutes.docx', 'training-minutes.docx', (actor, id) =>
    service.downloadMinutes(actor, id, 'docx'),
  )
  route('minutes.pdf', 'training-minutes.pdf', (actor, id) =>
    service.downloadMinutes(actor, id, 'pdf'),
  )
  route('export.zip', 'training-export.zip', (actor, id) => service.downloadZip(actor, id))
  route('class-sheet.xlsx', 'bang-diem-ren-luyen-lop.xlsx', (actor, id) =>
    service.downloadClassSheet(actor, id),
  )
  // ADR 0028: printed assessment form of one approved declaration (advisor, faculty, monitor).
  for (const format of ['docx', 'pdf'] as const)
    app.post<{ Params: { id: string; declarationId: string } }>(
      `/training-reviews/periods/:id/declarations/:declarationId/form.${format}`,
      {
        ...exportOptions,
        schema: {
          body: Type.Object({}, { additionalProperties: false }),
          params: Type.Object(
            {
              id: Type.String({ format: 'uuid' }),
              declarationId: Type.String({ format: 'uuid' }),
            },
            { additionalProperties: false },
          ),
        },
      },
      (request, reply) =>
        executeSubmission(request, reply, async () =>
          sendFile(
            reply,
            await service.downloadForm(
              submissionActor(request),
              request.params.id.toLowerCase(),
              request.params.declarationId.toLowerCase(),
              format,
            ),
            `phieu-danh-gia-ren-luyen.${format}`,
          ),
        ),
    )
}

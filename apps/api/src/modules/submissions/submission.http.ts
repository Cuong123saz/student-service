import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'
import { getAuditRequestContext } from '../audit/audit-request-context.js'
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_SESSION_COOKIE_NAME,
  JWT_ISSUER,
  USER_JWT_AUDIENCE,
  USER_SESSION_COOKIE_NAME,
} from '../auth/auth.constants.js'
import { isAdminSession, isUserSession } from '../auth/auth-session.js'
import { SubmissionError, type SubmissionActor } from './submission.types.js'
function sendError(request: FastifyRequest, reply: FastifyReply, error: SubmissionError) {
  return reply.code(error.statusCode).send({
    code: error.code,
    message: error.message,
    issues: error.issues,
    requestId: request.id,
  })
}
export function requireSubmissionSession(portal: 'user' | 'admin', student = false) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token =
      request.cookies[portal === 'user' ? USER_SESSION_COOKIE_NAME : ADMIN_SESSION_COOKIE_NAME]
    let session: unknown
    try {
      if (!token) throw new Error('No session')
      session = request.server.jwt.verify(token, {
        allowedAud: portal === 'user' ? USER_JWT_AUDIENCE : ADMIN_JWT_AUDIENCE,
        allowedIss: JWT_ISSUER,
      })
    } catch {
      return sendError(
        request,
        reply,
        new SubmissionError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'),
      )
    }
    if (portal === 'user' && isUserSession(session)) request.userSession = session
    else if (portal === 'admin' && isAdminSession(session)) request.adminSession = session
    else
      return sendError(
        request,
        reply,
        new SubmissionError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'),
      )
    const portalRoles =
      portal === 'admin'
        ? ['ADMIN', 'SYSTEM_ADMIN']
        : ['STUDENT', 'ACADEMIC_ADVISOR', 'FACULTY_REVIEWER', 'DOCUMENT_SIGNER']
    if (!session.roles.some((role) => portalRoles.includes(role)))
      return sendError(
        request,
        reply,
        new SubmissionError(403, 'FORBIDDEN', 'Vai trò trong phiên không được sử dụng cổng này.'),
      )
    if (session.mustChangePassword)
      return sendError(
        request,
        reply,
        new SubmissionError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Bạn cần đổi mật khẩu trước khi thao tác.',
        ),
      )
    if (student && !session.roles.includes('STUDENT'))
      return sendError(
        request,
        reply,
        new SubmissionError(403, 'FORBIDDEN', 'Chức năng này dành cho sinh viên.'),
      )
  }
}
export function submissionActor(request: FastifyRequest): SubmissionActor {
  const session = request.userSession ?? request.adminSession
  if (!session) throw new SubmissionError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ.')
  return { userId: session.sub, username: session.username, ...getAuditRequestContext(request) }
}
export async function submissionOrigin(request: FastifyRequest, reply: FastifyReply) {
  if (request.headers.origin !== env.corsOrigin)
    return sendError(
      request,
      reply,
      new SubmissionError(403, 'ORIGIN_REJECTED', 'Yêu cầu phải được gửi từ cổng dịch vụ.'),
    )
}
export async function executeSubmission(
  request: FastifyRequest,
  reply: FastifyReply,
  action: () => Promise<unknown>,
) {
  try {
    return await action()
  } catch (error) {
    if (error instanceof SubmissionError) return sendError(request, reply, error)
    // Never log database errors: query parameters may contain private answers.
    request.log.error({ requestId: request.id }, 'Submission operation failed')
    return sendError(
      request,
      reply,
      new SubmissionError(
        500,
        'SUBMISSION_FAILED',
        'Chưa thể xử lý hồ sơ. Hãy tải lại trạng thái trước khi thử tiếp.',
      ),
    )
  }
}
export function configureSubmissionErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const details =
      typeof error === 'object' && error !== null
        ? (error as { validation?: unknown; statusCode?: number })
        : {}
    if (details.validation)
      return sendError(
        request,
        reply,
        new SubmissionError(400, 'INVALID_REQUEST', 'Yêu cầu không đúng định dạng.'),
      )
    if (error instanceof SubmissionError) return sendError(request, reply, error)
    const status = details.statusCode
    if (status && status >= 400 && status < 500)
      return sendError(
        request,
        reply,
        new SubmissionError(status, 'INVALID_REQUEST', 'Không thể tiếp nhận yêu cầu này.'),
      )
    request.log.error({ requestId: request.id }, 'Submission request failed')
    return sendError(
      request,
      reply,
      new SubmissionError(
        500,
        'SUBMISSION_FAILED',
        'Chưa thể xử lý hồ sơ. Hãy tải lại trạng thái trước khi thử tiếp.',
      ),
    )
  })
}
export function sendEvidence(
  reply: FastifyReply,
  file: { bytes: Buffer; name: string; mimeType: string },
) {
  return reply
    .header('Content-Type', file.mimeType)
    .header(
      'Content-Disposition',
      'attachment; filename="evidence"; filename*=UTF-8\'\'' +
        encodeURIComponent(file.name).replace(
          /['()*]/g,
          (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
        ),
    )
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
    .send(file.bytes)
}

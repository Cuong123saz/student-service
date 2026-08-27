import type {
  FastifyInstance,
} from 'fastify'

const clientErrorMessages:
  Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    429: 'Too Many Requests',
  }
function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}

function isValidationError(
  error: unknown,
): boolean {
  return (
    isRecord(error)
    && Array.isArray(
      error.validation,
    )
  )
}

function getStatusCode(
  error: unknown,
): number | undefined {
  if (!isRecord(error)) {
    return undefined
  }

  return typeof error.statusCode
    === 'number'
    ? error.statusCode
    : undefined
}
export function configureGlobalErrorHandler(
  app: FastifyInstance,
) {
  app.setErrorHandler(
    (error, request, reply) => {
      if (isValidationError(error)) {
        return reply.code(400).send({
          message: 'Invalid request',
        })
      }

      const statusCode =
        getStatusCode(error)

      if (
        statusCode !== undefined
        && statusCode >= 400
        && statusCode < 500
      ) {
        return reply
          .code(statusCode)
          .send({
            message:
              clientErrorMessages[
                statusCode
              ] ?? 'Request failed',
          })
      }

      request.log.error(
        { err: error },
        'Unhandled request error',
      )

      return reply.code(500).send({
        message:
          'Internal Server Error',
      })
    },
  )
}
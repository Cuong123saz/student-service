import type { FastifyReply, FastifyRequest } from 'fastify'
import { executeSubmission } from '../submissions/submission.http.js'
import { SubmissionError } from '../submissions/submission.types.js'

/**
 * Input helpers shared by the user-portal modules of Sprint 11 (clubs, activities).
 * The global AJV setup strips unknown fields; these modules reject them instead of ignoring them.
 */
export function portalInput(errorCode: string) {
  const invalid = (message: string) => new SubmissionError(400, errorCode, message)
  return {
    invalid,
    strict: (value: unknown, fields: string[]) => {
      if (value && typeof value === 'object' && Object.keys(value).some((k) => !fields.includes(k)))
        throw invalid('Thông tin chứa trường không được phép.')
    },
    /** Removes control characters (keeps tab/newline) and trims. */
    text: (value: string, label: string, required = true) => {
      // eslint-disable-next-line no-control-regex
      const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
      if (required && !clean) throw invalid(label + ' không được để trống.')
      return clean
    },
  }
}

/**
 * Runs a portal action and maps unique violations and module guard triggers (messages starting with
 * `prefix`) to one stable 409, without leaking database details.
 */
export function portalExecute(prefix: string, code: string, message: string) {
  return (req: FastifyRequest, reply: FastifyReply, fn: () => Promise<unknown>) =>
    executeSubmission(req, reply, async () => {
      try {
        return await fn()
      } catch (e) {
        const x = e as { code?: string; message?: string }
        if (x.code === '23505' || (x.code === '23514' && x.message?.startsWith(prefix)))
          throw new SubmissionError(409, code, message)
        throw e
      }
    })
}

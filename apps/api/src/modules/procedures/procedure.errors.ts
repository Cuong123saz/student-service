import type { ValidationIssue } from './procedure.contract.js'
export class ProcedureError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'ProcedureError'
  }
}

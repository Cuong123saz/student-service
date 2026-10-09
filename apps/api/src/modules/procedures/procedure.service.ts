import type {
  CreateProcedureInput,
  ProcedureActor,
  ProcedureCatalog,
  ProcedureVersion,
  PublicProcedure,
  UpdateProcedureInput,
  ValidationIssue,
} from './procedure.contract.js'
import { ProcedureError } from './procedure.errors.js'
import { validateProcedureConfig } from './procedure.validation.js'
export interface ProcedureRepository {
  catalog(actorId: string): Promise<ProcedureCatalog>
  list(actorId: string, serviceId: number): Promise<ProcedureVersion[]>
  create(actor: ProcedureActor, input: CreateProcedureInput): Promise<ProcedureVersion>
  update(actor: ProcedureActor, id: string, input: UpdateProcedureInput): Promise<ProcedureVersion>
  validate(actorId: string, id: string): Promise<ValidationIssue[]>
  publish(actor: ProcedureActor, id: string, expectedRevision: number): Promise<ProcedureVersion>
  published(serviceId: number): Promise<PublicProcedure | null>
}
export type ProcedureUseCase = ProcedureRepository
export class ProcedureService implements ProcedureUseCase {
  constructor(private readonly repository: ProcedureRepository) {}
  catalog(actorId: string) {
    return this.repository.catalog(actorId)
  }
  list(actorId: string, serviceId: number) {
    return this.repository.list(actorId, serviceId)
  }
  create(actor: ProcedureActor, input: CreateProcedureInput) {
    return this.repository.create(actor, input)
  }
  update(actor: ProcedureActor, id: string, input: UpdateProcedureInput) {
    const issues = validateProcedureConfig(input.config)
    if (issues.length)
      throw new ProcedureError(422, 'INVALID_CONFIG', 'Cấu hình cần được sửa.', issues)
    return this.repository.update(actor, id, input)
  }
  validate(actorId: string, id: string) {
    return this.repository.validate(actorId, id)
  }
  publish(actor: ProcedureActor, id: string, expectedRevision: number) {
    return this.repository.publish(actor, id, expectedRevision)
  }
  published(serviceId: number) {
    return this.repository.published(serviceId)
  }
}

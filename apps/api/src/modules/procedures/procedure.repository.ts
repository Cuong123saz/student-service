import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db } from '../../db/client.js'
import { services } from '../../db/schema.js'
import { auditLogs } from '../audit/audit.schema.js'
import { users, userRoles } from '../auth/auth.schema.js'
import {
  authorizationScopes,
  permissions,
  rolePermissions,
  userRoleScopes,
} from '../auth/authorization.schema.js'
import { organizationalUnits } from '../organizations/organization.schema.js'
import type {
  CreateProcedureInput,
  ProcedureActor,
  ProcedureConfig,
  ProcedureVersion,
  UpdateProcedureInput,
  ValidationIssue,
} from './procedure.contract.js'
import type { ProcedureRepository } from './procedure.service.js'
import { procedureVersions } from './procedure.schema.js'
import { defaultProcedureConfig, validateProcedureConfig } from './procedure.validation.js'
import { ProcedureError } from './procedure.errors.js'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
interface Authority {
  scopeType: string
  unitId: string | null
}
const forbidden = () =>
  new ProcedureError(403, 'FORBIDDEN', 'Bạn không có quyền cấu hình thủ tục trong phạm vi này.')
const notFound = () => new ProcedureError(404, 'NOT_FOUND', 'Không tìm thấy cấu hình thủ tục.')
const conflict = () =>
  new ProcedureError(
    409,
    'VERSION_CONFLICT',
    'Cấu hình đã thay đổi. Hãy tải lại trước khi tiếp tục.',
  )
function allowed(scopes: Authority[], unitId: string) {
  return scopes.some(
    (scope) =>
      scope.scopeType === 'GLOBAL' ||
      (scope.scopeType === 'ORGANIZATION' && scope.unitId === unitId),
  )
}
function global(scopes: Authority[]) {
  return scopes.some((scope) => scope.scopeType === 'GLOBAL')
}

export class DrizzleProcedureRepository implements ProcedureRepository {
  constructor(private readonly database: typeof db = db) {}
  private async authority(tx: Transaction, actorId: string): Promise<Authority[]> {
    const rows = await tx
      .select({
        scopeType: authorizationScopes.scopeType,
        unitId: authorizationScopes.organizationalUnitId,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .innerJoin(
        userRoleScopes,
        and(
          eq(userRoleScopes.userId, userRoles.userId),
          eq(userRoleScopes.roleId, userRoles.roleId),
        ),
      )
      .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
      .where(
        and(
          eq(users.id, actorId),
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, 'service.configure'),
          inArray(authorizationScopes.scopeType, ['GLOBAL', 'ORGANIZATION']),
        ),
      )
    if (!rows.length) throw forbidden()
    return rows
  }
  private reviewerRows(tx: Transaction) {
    return tx
      .selectDistinct({
        id: users.id,
        name: users.fullName,
        unitId: authorizationScopes.organizationalUnitId,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .innerJoin(
        userRoleScopes,
        and(
          eq(userRoleScopes.userId, userRoles.userId),
          eq(userRoleScopes.roleId, userRoles.roleId),
        ),
      )
      .innerJoin(authorizationScopes, eq(userRoleScopes.scopeId, authorizationScopes.id))
      .where(
        and(
          eq(users.status, 'ACTIVE'),
          eq(permissions.code, 'submission.review'),
          inArray(authorizationScopes.scopeType, ['GLOBAL', 'ORGANIZATION']),
        ),
      )
  }
  private async checkConfig(
    tx: Transaction,
    config: ProcedureConfig,
    requireReviewer: boolean,
  ): Promise<ValidationIssue[]> {
    const issues = validateProcedureConfig(config)
    const unit = (
      await tx
        .select()
        .from(organizationalUnits)
        .where(eq(organizationalUnits.id, config.processingUnitId))
        .limit(1)
    )[0]
    if (!unit || unit.status !== 'ACTIVE')
      issues.push({
        path: 'processingUnitId',
        message: 'Đơn vị xử lý không tồn tại hoặc đã ngừng hoạt động.',
      })
    if (config.processorUserId || (requireReviewer && config.processingMode !== 'OFFLINE')) {
      const reviewers = (await this.reviewerRows(tx)).filter(
        (reviewer) =>
          (reviewer.unitId === null || reviewer.unitId === config.processingUnitId) &&
          (!config.processorUserId || reviewer.id === config.processorUserId),
      )
      if (!reviewers.length)
        issues.push({
          path: 'processorUserId',
          message: 'Chưa có cán bộ ACTIVE có quyền xét duyệt trong đơn vị được chọn.',
        })
    }
    return issues
  }
  private async audit(
    tx: Transaction,
    actor: ProcedureActor,
    action: string,
    version: ProcedureVersion,
  ) {
    await tx.insert(auditLogs).values({
      actorType: 'USER',
      actorUserId: actor.userId,
      actorUsername: actor.username,
      action,
      resourceType: 'PROCEDURE_VERSION',
      resourceId: version.id,
      outcome: 'SUCCESS',
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        serviceId: version.serviceId,
        versionNumber: version.versionNumber,
        revision: version.revision,
        status: version.status,
        configHash: createHash('sha256').update(JSON.stringify(version.config)).digest('hex'),
      },
    })
  }
  private async target(tx: Transaction, actorId: string, id: string, lock = false) {
    // Acquire service before version everywhere to prevent a create/publish deadlock.
    const reference = (
      await tx
        .select({ serviceId: procedureVersions.serviceId })
        .from(procedureVersions)
        .where(eq(procedureVersions.id, id))
        .limit(1)
    )[0]
    if (!reference) throw notFound()
    if (lock)
      await tx.select().from(services).where(eq(services.id, reference.serviceId)).for('update')
    const scopes = await this.authority(tx, actorId)
    const row = (
      await tx.select().from(procedureVersions).where(eq(procedureVersions.id, id)).limit(1)
    )[0]
    if (!row) throw notFound()
    if (!allowed(scopes, row.ownerUnitId)) throw forbidden()
    return { row, scopes }
  }
  async catalog(actorId: string) {
    return this.database.transaction(async (tx) => {
      const scopes = await this.authority(tx, actorId)
      const units = (
        await tx
          .select({
            id: organizationalUnits.id,
            code: organizationalUnits.code,
            name: organizationalUnits.name,
          })
          .from(organizationalUnits)
          .where(eq(organizationalUnits.status, 'ACTIVE'))
          .orderBy(asc(organizationalUnits.code))
      ).filter((unit) => allowed(scopes, unit.id))
      const serviceRows = await tx
        .select({
          id: services.id,
          code: services.code,
          name: services.name,
          status: services.status,
        })
        .from(services)
        .orderBy(asc(services.name))
      const versions = await tx
        .select({
          serviceId: procedureVersions.serviceId,
          ownerUnitId: procedureVersions.ownerUnitId,
        })
        .from(procedureVersions)
      return {
        services: global(scopes)
          ? serviceRows
          : serviceRows.filter((service) =>
              versions.some((v) => v.serviceId === service.id && allowed(scopes, v.ownerUnitId)),
            ),
        units,
        reviewers: (await this.reviewerRows(tx)).filter(
          (row) => row.unitId === null || units.some((unit) => unit.id === row.unitId),
        ),
        canCreate: global(scopes),
      }
    })
  }
  async list(actorId: string, serviceId: number) {
    return this.database.transaction(async (tx) => {
      const scopes = await this.authority(tx, actorId)
      const rows = await tx
        .select()
        .from(procedureVersions)
        .where(eq(procedureVersions.serviceId, serviceId))
        .orderBy(desc(procedureVersions.versionNumber))
      return rows.filter((row) => allowed(scopes, row.ownerUnitId))
    })
  }
  async create(actor: ProcedureActor, input: CreateProcedureInput) {
    return this.database.transaction(async (tx) => {
      const service = (
        await tx.select().from(services).where(eq(services.id, input.serviceId)).for('update')
      )[0]
      if (!service) throw new ProcedureError(404, 'SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại.')
      const scopes = await this.authority(tx, actor.userId)
      const existing = await tx
        .select()
        .from(procedureVersions)
        .where(eq(procedureVersions.serviceId, input.serviceId))
        .orderBy(desc(procedureVersions.versionNumber))

      const cloned = input.cloneVersionId
        ? existing.find((row) => row.id === input.cloneVersionId)
        : undefined
      if (input.cloneVersionId && !cloned) throw notFound()
      const ownerUnitId = cloned?.ownerUnitId ?? input.ownerUnitId
      if (!allowed(scopes, ownerUnitId) || (!cloned && !global(scopes))) throw forbidden()
      if (input.ownerUnitId !== ownerUnitId) throw forbidden()
      if (existing.some((row) => row.status === 'DRAFT'))
        throw new ProcedureError(409, 'DRAFT_EXISTS', 'Dịch vụ đã có bản nháp. Hãy mở bản nháp đó.')
      const owner = (
        await tx
          .select()
          .from(organizationalUnits)
          .where(eq(organizationalUnits.id, ownerUnitId))
          .limit(1)
      )[0]
      if (!owner || owner.status !== 'ACTIVE')
        throw new ProcedureError(422, 'INVALID_OWNER', 'Đơn vị sở hữu phải đang hoạt động.')
      const config = cloned?.config ?? defaultProcedureConfig(ownerUnitId)
      if (!cloned && service.code === 'STUDENT_CONFIRMATION') {
        config.contactInstructions =
          'Sinh viên đến trực tiếp ' +
          owner.name +
          ' để được hướng dẫn và xử lý giấy xác nhận sinh viên.'
      }
      const inserted = (
        await tx
          .insert(procedureVersions)
          .values({
            serviceId: input.serviceId,
            ownerUnitId,
            versionNumber: (existing[0]?.versionNumber ?? 0) + 1,
            config,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning()
      )[0]
      if (!inserted) throw new Error('Procedure draft was not inserted')
      await this.audit(tx, actor, 'PROCEDURE_DRAFT_CREATE', inserted)
      return inserted
    })
  }
  async update(actor: ProcedureActor, id: string, input: UpdateProcedureInput) {
    return this.database.transaction(async (tx) => {
      const { row, scopes } = await this.target(tx, actor.userId, id, true)
      if (row.status !== 'DRAFT' || row.revision !== input.expectedRevision) throw conflict()
      if (!global(scopes) && input.config.processingUnitId !== row.ownerUnitId) throw forbidden()
      const issues = await this.checkConfig(tx, input.config, false)
      if (issues.length)
        throw new ProcedureError(422, 'INVALID_CONFIG', 'Cấu hình cần được sửa.', issues)
      const updated = (
        await tx
          .update(procedureVersions)
          .set({
            config: input.config,
            revision: row.revision + 1,
            updatedBy: actor.userId,
            updatedAt: new Date(),
          })
          .where(eq(procedureVersions.id, id))
          .returning()
      )[0]
      if (!updated) throw notFound()
      await this.audit(tx, actor, 'PROCEDURE_DRAFT_UPDATE', updated)
      return updated
    })
  }
  async validate(actorId: string, id: string) {
    return this.database.transaction(async (tx) => {
      const { row } = await this.target(tx, actorId, id)
      return this.checkConfig(tx, row.config, true)
    })
  }
  async publish(actor: ProcedureActor, id: string, expectedRevision: number) {
    return this.database.transaction(async (tx) => {
      const { row } = await this.target(tx, actor.userId, id, true)
      if (row.status !== 'DRAFT' || row.revision !== expectedRevision) throw conflict()
      const service = (
        await tx.select().from(services).where(eq(services.id, row.serviceId)).limit(1)
      )[0]
      const owner = (
        await tx
          .select()
          .from(organizationalUnits)
          .where(eq(organizationalUnits.id, row.ownerUnitId))
          .limit(1)
      )[0]
      if (service?.status !== 'ACTIVE' || owner?.status !== 'ACTIVE')
        throw new ProcedureError(
          422,
          'INACTIVE_TARGET',
          'Dịch vụ và đơn vị sở hữu phải đang hoạt động.',
        )
      const issues = await this.checkConfig(tx, row.config, true)
      if (issues.length)
        throw new ProcedureError(422, 'INVALID_CONFIG', 'Chưa thể áp dụng cấu hình.', issues)
      const previous = await tx
        .update(procedureVersions)
        .set({ status: 'RETIRED', updatedAt: new Date(), updatedBy: actor.userId })
        .where(
          and(
            eq(procedureVersions.serviceId, row.serviceId),
            eq(procedureVersions.status, 'PUBLISHED'),
          ),
        )
        .returning()
      for (const retired of previous)
        await this.audit(tx, actor, 'PROCEDURE_VERSION_RETIRE', retired)
      const published = (
        await tx
          .update(procedureVersions)
          .set({
            status: 'PUBLISHED',
            publishedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: actor.userId,
            revision: row.revision + 1,
          })
          .where(eq(procedureVersions.id, id))
          .returning()
      )[0]
      if (!published) throw notFound()
      await this.audit(tx, actor, 'PROCEDURE_VERSION_PUBLISH', published)
      return published
    })
  }
  async published(serviceId: number) {
    const result = (
      await this.database
        .select({ version: procedureVersions, unitName: organizationalUnits.name })
        .from(procedureVersions)
        .innerJoin(services, eq(procedureVersions.serviceId, services.id))
        .innerJoin(
          organizationalUnits,
          eq(
            organizationalUnits.id,
            sql.raw("(procedure_versions.config->>'processingUnitId')::uuid"),
          ),
        )
        .where(
          and(
            eq(services.id, serviceId),
            eq(services.status, 'ACTIVE'),
            eq(procedureVersions.status, 'PUBLISHED'),
            eq(organizationalUnits.status, 'ACTIVE'),
            sql.raw(
              "EXISTS (SELECT 1 FROM organizational_units owner WHERE owner.id = procedure_versions.owner_unit_id AND owner.status = 'ACTIVE')",
            ),
          ),
        )
        .limit(1)
    )[0]
    if (!result) return null
    const { version, unitName } = result
    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      processingMode: version.config.processingMode,
      processingUnitName: unitName,
      contactInstructions: version.config.contactInstructions,
      fields: version.config.fields,
      attachments: version.config.attachments,
      maxTotalAttachmentBytes: version.config.maxTotalAttachmentBytes,
    }
  }
}

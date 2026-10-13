import assert from 'node:assert/strict'
export const developmentVolume = 'student-service-api_student_service_data'
export function assertOfflineDevelopmentInvocation(args, env) {
  assert.ok(
    args[0] === '--offline-development-only' &&
      (args.length === 1 || (args.length === 2 && args[1] === '--verify-upgrade')),
    'REQUIRES_OFFLINE_DEVELOPMENT_FLAG',
  )
  assert.ok(
    !env.DATABASE_URL && !env.SUBMISSION_STORAGE_ROOT && env.APP_ENV !== 'production',
    'EXTERNAL_CONFIGURATION_REFUSED',
  )
}
export function assertOfflineDevelopmentSource(info, expectedId) {
  assert.ok(
    info?.Name === '/student-service-postgres' &&
      /^[a-f0-9]{64}$/.test(info.Id || '') &&
      (!expectedId || info.Id === expectedId) &&
      info.State?.Status === 'exited' &&
      info.State.Running === false &&
      info.Config?.Image === 'postgres:17-alpine' &&
      /^sha256:[a-f0-9]{64}$/.test(info.Image || ''),
    'OFFLINE_DEVELOPMENT_SOURCE_MISMATCH',
  )
  assert.ok(
    info.Mounts?.length === 1 &&
      info.Mounts[0].Type === 'volume' &&
      info.Mounts[0].Name === developmentVolume &&
      info.Mounts[0].Destination === '/var/lib/postgresql/data',
    'DEVELOPMENT_VOLUME_MISMATCH',
  )
  const ports = info.HostConfig?.PortBindings?.['5432/tcp']
  assert.ok(ports?.length === 1 && ports[0].HostPort === '5433', 'DEVELOPMENT_PORT_MISMATCH')
}
export function assertDevelopmentVolumeQuiescent(infos) {
  assert.ok(
    !infos.some(
      (i) =>
        i.State?.Running &&
        i.Mounts?.some((m) => m.Type === 'volume' && m.Name === developmentVolume && m.RW),
    ),
    'DEVELOPMENT_VOLUME_WRITER_ACTIVE',
  )
}
export function assertPreservationContainer(info, runId, id, kind, imageId) {
  assert.ok(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) &&
      ['source', 'target', 'reader'].includes(kind) &&
      /^[a-f0-9]{64}$/.test(id) &&
      info.Id === id &&
      info.Name === '/student-service-dev-preserve-' + runId + '-' + kind &&
      info.Image === imageId &&
      info.Config?.Labels?.['student-service.development-preservation-id'] === runId &&
      Array.isArray(info.Mounts) &&
      (kind === 'reader'
        ? info.HostConfig?.ReadonlyRootfs === true &&
          info.HostConfig?.NetworkMode === 'none' &&
          info.Mounts.length === 1 &&
          info.Mounts[0].Type === 'volume' &&
          info.Mounts[0].Name === developmentVolume &&
          info.Mounts[0].Destination === '/source' &&
          info.Mounts[0].RW === false
        : Object.keys(info.HostConfig?.Tmpfs || {}).length === 1 &&
          info.HostConfig.Tmpfs['/var/lib/postgresql/data'] === 'rw,size=536870912' &&
          info.Mounts.every((mount) => mount.Type === 'tmpfs')),
    'PRESERVATION_CONTAINER_OWNERSHIP_MISMATCH',
  )
}

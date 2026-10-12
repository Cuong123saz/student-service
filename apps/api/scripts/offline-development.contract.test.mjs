import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import {
  developmentVolume,
  assertOfflineDevelopmentInvocation,
  assertOfflineDevelopmentSource,
  assertDevelopmentVolumeQuiescent,
  assertPreservationContainer,
} from './offline-development.contract.mjs'
const source = () => ({
  Id: 'a'.repeat(64),
  Name: '/student-service-postgres',
  Image: 'sha256:' + 'b'.repeat(64),
  Config: { Image: 'postgres:17-alpine' },
  State: { Status: 'exited', Running: false },
  Mounts: [
    { Type: 'volume', Name: developmentVolume, Destination: '/var/lib/postgresql/data', RW: true },
  ],
  HostConfig: { PortBindings: { '5432/tcp': [{ HostPort: '5433' }] } },
})
test('offline preservation refuses production, inherited databases/storage and arbitrary options', () => {
  assertOfflineDevelopmentInvocation(['--offline-development-only'], {})
  for (const args of [[], ['--fake-data-only'], ['--offline-development-only', 'reset']])
    assert.throws(() => assertOfflineDevelopmentInvocation(args, {}))
  for (const env of [
    { APP_ENV: 'production' },
    { DATABASE_URL: 'fake' },
    { SUBMISSION_STORAGE_ROOT: 'fake' },
  ])
    assert.throws(() => assertOfflineDevelopmentInvocation(['--offline-development-only'], env))
})
test('source must be the stopped development container with its exact persistent volume and port', () => {
  assertOfflineDevelopmentSource(source())
  assert.throws(() => assertOfflineDevelopmentSource(source(), 'c'.repeat(64)))
  for (const changes of [
    { Name: '/student-service-postgres-test' },
    { State: { Status: 'running', Running: true } },
    { State: { Status: 'paused', Running: false } },
    { Config: { Image: 'postgres:latest' } },
    { Mounts: [] },
    { Mounts: [{ ...source().Mounts[0], Name: 'foreign' }] },
    { Mounts: [{ ...source().Mounts[0], Type: 'bind' }] },
    { HostConfig: { PortBindings: { '5432/tcp': [{ HostPort: '5434' }] } } },
  ])
    assert.throws(() => assertOfflineDevelopmentSource({ ...source(), ...changes }))
})
test('any running writer on the original volume blocks preservation; read-only readers are allowed', () => {
  assertDevelopmentVolumeQuiescent([source()])
  const active = { ...source(), State: { Running: true } }
  assert.throws(() => assertDevelopmentVolumeQuiescent([active]))
  assertDevelopmentVolumeQuiescent([{ ...active, Mounts: [{ ...active.Mounts[0], RW: false }] }])
})
test('cleanup only recognizes UUID-owned temporary clones of the pinned source image', () => {
  const run = randomUUID(),
    id = 'a'.repeat(64),
    image = 'sha256:' + 'b'.repeat(64)
  const info = {
    Id: id,
    Name: '/student-service-dev-preserve-' + run + '-source',
    Image: image,
    Config: { Labels: { 'student-service.development-preservation-id': run } },
    HostConfig: { Tmpfs: { '/var/lib/postgresql/data': 'rw,size=536870912' } },
    Mounts: [],
  }
  assertPreservationContainer(info, run, id, 'source', image)
  for (const changes of [
    { Name: '/student-service-postgres' },
    { Id: 'c'.repeat(64) },
    { Image: 'sha256:' + 'c'.repeat(64) },
    { Config: { Labels: {} } },
    { Mounts: [{ Type: 'volume' }] },
    { Mounts: [{ Type: 'bind' }] },
    { HostConfig: { Tmpfs: {} } },
  ])
    assert.throws(() =>
      assertPreservationContainer({ ...info, ...changes }, run, id, 'source', image),
    )
})

test('physical-copy reader can only mount the original volume read-only without network or writable rootfs', () => {
  const run = randomUUID(),
    id = 'a'.repeat(64),
    image = 'sha256:' + 'b'.repeat(64)
  const info = {
    Id: id,
    Name: '/student-service-dev-preserve-' + run + '-reader',
    Image: image,
    Config: { Labels: { 'student-service.development-preservation-id': run } },
    HostConfig: { ReadonlyRootfs: true, NetworkMode: 'none' },
    Mounts: [{ Type: 'volume', Name: developmentVolume, Destination: '/source', RW: false }],
  }
  assertPreservationContainer(info, run, id, 'reader', image)
  for (const change of [
    { HostConfig: { ...info.HostConfig, ReadonlyRootfs: false } },
    { HostConfig: { ...info.HostConfig, NetworkMode: 'default' } },
    { Mounts: [{ ...info.Mounts[0], RW: true }] },
    { Mounts: [{ ...info.Mounts[0], Name: 'foreign' }] },
  ])
    assert.throws(() =>
      assertPreservationContainer({ ...info, ...change }, run, id, 'reader', image),
    )
})

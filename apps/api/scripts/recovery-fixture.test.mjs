import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import Fastify from 'fastify'
import { procedureConfigSchema } from '../src/modules/procedures/procedure.contract.ts'
import { validateProcedureConfig } from '../src/modules/procedures/procedure.validation.ts'
import {
  completionIssues,
  inspectEvidence,
  validateAnswers,
} from '../src/modules/submissions/submission.validation.ts'
import {
  newBytes,
  oldBytes,
  recoveryConfig,
  recoveryStudent,
  recoveryValues,
} from './recovery-fixture.mjs'

const unitId = '5294e2b8-f01e-4ca3-8c17-b15e0924b111'
const config = recoveryConfig(unitId)
// Require exact fixture types, without coercing strings to numbers or booleans.
const validator = Fastify({ ajv: { customOptions: { coerceTypes: false } } })
validator.post('/config', { schema: { body: procedureConfigSchema } }, async () => ({
  valid: true,
}))
after(() => validator.close())

test('fake procedure passes the application schema and business validator with all six field types', async () => {
  const response = await validator.inject({ method: 'POST', url: '/config', payload: config })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(validateProcedureConfig(config), [])
  assert.deepEqual([...new Set(config.fields.map((f) => f.type))].sort(), [
    'BOOLEAN',
    'DATE',
    'NUMBER',
    'SELECT',
    'TEXT',
    'TEXTAREA',
  ])
})
for (const [name, change] of [
  [
    'non-UUID unit',
    (c) => {
      c.processingUnitId = 'fake-unit'
    },
  ],
  [
    'string attachment size',
    (c) => {
      c.attachments[0].maxBytes = '4096'
    },
  ],
  [
    'string required flag',
    (c) => {
      c.fields[0].required = 'true'
    },
  ],
  [
    'unknown field type',
    (c) => {
      c.fields[0].type = 'EMAIL'
    },
  ],
])
  test('fake fixture contract refuses ' + name, async () => {
    const invalid = structuredClone(config)
    change(invalid)
    const response = await validator.inject({ method: 'POST', url: '/config', payload: invalid })
    assert.equal(response.statusCode, 400)
  })
for (const round of [1, 2])
  test('fake round ' + round + ' has valid, complete answers including profile fields', () => {
    const values = recoveryValues(round)
    assert.deepEqual(validateAnswers(config, values), [])
    const full = { ...recoveryStudent, ...values }
    assert.deepEqual(validateAnswers(config, full, true), [])
    assert.deepEqual(completionIssues(config, full, [{ attachmentKey: 'proof' }]), [])
    assert.equal(typeof values.completedCredits, 'number')
    assert.equal(typeof values.instructionsReceived, 'boolean')
  })
test('zero and false are retained through JSON without becoming missing values', () => {
  const restored = JSON.parse(JSON.stringify({ ...recoveryStudent, ...recoveryValues(1) }))
  assert.equal(restored.completedCredits, 0)
  assert.equal(restored.instructionsReceived, false)
  assert.deepEqual(completionIssues(config, restored, [{ attachmentKey: 'proof' }]), [])
})
for (const [key, value] of [
  ['reference', 123],
  ['purpose', false],
  ['completedCredits', '0'],
  ['instructionsReceived', 'false'],
  ['neededOn', '2026-02-30'],
  ['purposeType', 'NOT_AN_OPTION'],
  ['fullName', 'Profile override'],
  ['unknownField', 'x'],
])
  test('application rejects invalid fake answer for ' + key, () => {
    const issues = validateAnswers(config, { [key]: value })
    assert.deepEqual(
      issues.map((i) => i.path),
      ['values.' + key],
    )
  })
test('required fake answers cannot be omitted at submission', () => {
  const full = { ...recoveryStudent, ...recoveryValues(1) }
  delete full.neededOn
  assert.deepEqual(
    completionIssues(config, full, [{ attachmentKey: 'proof' }]).map((i) => i.path),
    ['values.neededOn'],
  )
})
// These exact bytes were parsed with pypdf strict=True and rendered with Poppler.
// Pinning hashes detects accidental replacement by a PDF-header-only mock.
const pdfHashes = [
  '28d7a4fd7965c55a98fa87422d3bbe7913b02767d0c77075313533c6ce61a93d',
  '2d82c8427f99ed046335179759f26834e69391e3e5425a57ceadc7f419089b5d',
]
for (const [index, bytes] of [oldBytes, newBytes].entries())
  test('round ' + (index + 1) + ' uses the independently verified PDF fixture', () => {
    const meta = inspectEvidence(bytes, 'proof.pdf', 'application/pdf')
    assert.equal(meta.sha256, pdfHashes[index])
    assert.ok(meta.size <= config.attachments[0].maxBytes)
    assert.ok(bytes.subarray(-20).toString('ascii').includes('%%EOF'))
    assert.ok(bytes.includes(Buffer.from('TEST DATA - NOT AN OFFICIAL DOCUMENT')))
  })
test('two evidence rounds are distinct originals', () => assert.notDeepEqual(oldBytes, newBytes))

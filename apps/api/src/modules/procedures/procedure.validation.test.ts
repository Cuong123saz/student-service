import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Value } from '@sinclair/typebox/value'
import { fieldSchema } from './procedure.contract.js'
import { defaultProcedureConfig, validateProcedureConfig } from './procedure.validation.js'
const unitId = '5294e2b8-f01e-4ca3-8c17-b15e0924b111'
test('offline configuration does not invent an online reviewer', () => {
  const config = defaultProcedureConfig(unitId)
  assert.equal(config.processingMode, 'OFFLINE')
  assert.equal(config.processorUserId, null)
  assert.deepEqual(validateProcedureConfig(config), [])
})
test('duplicate field keys are rejected', () => {
  const config = defaultProcedureConfig(unitId)
  config.fields.push({ ...config.fields[0]! })
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path === 'fields.2.key'))
})
test('profile fields cannot become editable numbers', () => {
  const config = defaultProcedureConfig(unitId)
  config.fields[0]!.type = 'NUMBER'
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path === 'fields.0.source'))
})
test('student input cannot spoof an auto-filled profile source', () => {
  const config = defaultProcedureConfig(unitId)
  config.fields[0]!.source = 'STUDENT_INPUT'
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path === 'fields.0.source'))
})
test('profile source allowlist excludes credentials', () => {
  const field = { ...defaultProcedureConfig(unitId).fields[0], profileKey: 'passwordHash' }
  assert.equal(Value.Check(fieldSchema, field), false)
})
test('field keys cannot contain executable markup', () => {
  const field = { ...defaultProcedureConfig(unitId).fields[0], key: '<script>' }
  assert.equal(Value.Check(fieldSchema, field), false)
})
test('SELECT requires choices and rejects duplicate choice values', () => {
  const config = defaultProcedureConfig(unitId)
  const field = config.fields[0]!
  field.source = 'STUDENT_INPUT'
  field.profileKey = null
  field.type = 'SELECT'
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path.endsWith('.options')))
  field.options = [
    { value: 'a', label: 'Một' },
    { value: 'a', label: 'Hai' },
  ]
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path.endsWith('.options')))
})
test('non-SELECT fields reject hidden options', () => {
  const config = defaultProcedureConfig(unitId)
  config.fields[0]!.options = [{ value: 'a', label: 'Một' }]
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path.endsWith('.options')))
})
test('whitespace-only contact instructions are rejected', () => {
  const config = defaultProcedureConfig(unitId)
  config.contactInstructions = '  '
  assert.ok(validateProcedureConfig(config).some((issue) => issue.path === 'contactInstructions'))
})
test('required evidence cannot exceed total file budget', () => {
  const config = defaultProcedureConfig(unitId)
  config.maxTotalAttachmentBytes = 1024
  config.attachments.push({
    key: 'proof',
    label: 'Minh chứng',
    required: true,
    mimeTypes: ['application/pdf'],
    maxFiles: 1,
    maxBytes: 2048,
  })
  assert.ok(
    validateProcedureConfig(config).some((issue) => issue.path === 'attachments.0.maxBytes'),
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  newCertificateCode,
  rotatingCheckinCode,
  rotatingWindowMs,
  staticCheckinCode,
  verifyCheckinCode,
} from './activity-checkin.js'
import { stripJpegMetadata } from './activity-photo.js'
import { SubmissionError } from '../submissions/submission.types.js'

const secret = 'a'.repeat(64)
test('static codes verify only in static mode; rotating codes only for two windows', () => {
  const printed = staticCheckinCode(secret)
  assert.equal(verifyCheckinCode(secret, false, printed), true)
  assert.equal(
    verifyCheckinCode(secret, true, printed),
    false,
    'rotating mode retires the printout',
  )
  assert.equal(verifyCheckinCode('b'.repeat(64), false, printed), false)
  const now = 1_800_000_000_000
  const current = rotatingCheckinCode(secret, now)
  assert.equal(verifyCheckinCode(secret, true, current, now), true)
  assert.equal(verifyCheckinCode(secret, true, current, now + rotatingWindowMs), true)
  assert.equal(verifyCheckinCode(secret, true, current, now + 2 * rotatingWindowMs), false)
  assert.equal(verifyCheckinCode(secret, false, current, now), false)
  assert.equal(verifyCheckinCode(secret, false, printed + 'x'), false)
  assert.equal(verifyCheckinCode(secret, false, '../../etc'), false)
})
test('certificate codes are CN- plus 12 base32 characters and unique in practice', () => {
  const codes = new Set(Array.from({ length: 2000 }, newCertificateCode))
  assert.equal(codes.size, 2000)
  for (const c of codes) assert.match(c, /^CN-[A-Z2-7]{12}$/)
})

const seg = (marker: number, body: Buffer) => {
  const head = Buffer.alloc(4)
  head[0] = 0xff
  head[1] = marker
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}
const jfif = seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'))
const exif = seg(0xe1, Buffer.from('Exif\0\0GPS-LAT=21.0285;LON=105.8542', 'binary'))
const comment = seg(0xfe, Buffer.from('camera serial 12345'))
const quant = seg(0xdb, Buffer.alloc(65, 1))
const scan = Buffer.concat([
  seg(0xda, Buffer.alloc(10, 2)),
  Buffer.from([7, 8, 0xff, 0x00, 9]),
  Buffer.from([0xff, 0xd9]),
])
const soi = Buffer.from([0xff, 0xd8])

test('JPEG metadata (EXIF/GPS, comments) is removed and image data kept byte for byte', () => {
  const clean = stripJpegMetadata(Buffer.concat([soi, jfif, exif, comment, quant, scan]))
  assert.deepEqual(clean, Buffer.concat([soi, jfif, quant, scan]))
  assert.equal(clean.includes(Buffer.from('GPS')), false)
  assert.equal(clean.includes(Buffer.from('serial')), false)
})
test('non-JPEG, truncated or oversized input is rejected', () => {
  const bad = (b: Buffer) =>
    assert.throws(
      () => stripJpegMetadata(b),
      (e) => e instanceof SubmissionError && e.code === 'INVALID_ACTIVITY_PHOTO',
    )
  bad(Buffer.from('%PDF-1.7'))
  bad(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  bad(Buffer.concat([soi, jfif]))
  bad(Buffer.concat([soi, jfif, Buffer.from([0xff, 0xe1, 0xff, 0xff])]))
  bad(Buffer.concat([soi, quant, seg(0xda, Buffer.alloc(4)), Buffer.from([1, 2])]))
  bad(Buffer.alloc(2 * 1024 * 1024 + 1, 0xff))
})

import { SubmissionError } from '../submissions/submission.types.js'

/** ADR 0032: check-in photos are JPEG only, at most 2 MB. */
export const activityPhotoMaxBytes = 2 * 1024 * 1024
const invalid = () =>
  new SubmissionError(
    400,
    'INVALID_ACTIVITY_PHOTO',
    'Ảnh điểm danh phải là JPEG chụp từ camera, tối đa 2 MB.',
  )

/**
 * Returns a copy of the JPEG without APP1–APP15 and COM segments (EXIF, GPS, XMP, ICC, comments).
 * APP0 (JFIF) and every image segment are kept byte for byte; the entropy-coded data after SOS is
 * copied unchanged. Throws on anything that is not a well-formed baseline/progressive JPEG.
 */
export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input.length > activityPhotoMaxBytes) throw invalid()
  if (input[0] !== 0xff || input[1] !== 0xd8) throw invalid()
  const parts: Buffer[] = [input.subarray(0, 2)]
  let i = 2
  while (i < input.length) {
    if (input[i] !== 0xff) throw invalid()
    // Fill bytes (0xFF padding) are allowed between segments.
    while (input[i] === 0xff && i < input.length) i++
    const marker = input[i]
    if (marker === undefined) throw invalid()
    const start = i - 1
    i++
    // Standalone markers without a length.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) throw invalid()
    if (marker === 0xd9) {
      parts.push(input.subarray(start, i))
      return Buffer.concat(parts)
    }
    if (i + 2 > input.length) throw invalid()
    const length = input.readUInt16BE(i)
    if (length < 2 || i + length > input.length) throw invalid()
    const end = i + length
    if (marker === 0xda) {
      // Start of scan: keep the header and everything after it up to and including EOI.
      parts.push(input.subarray(start))
      const out = Buffer.concat(parts)
      if (out[out.length - 2] !== 0xff || out[out.length - 1] !== 0xd9) throw invalid()
      return out
    }
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
    if (!metadata) parts.push(input.subarray(start, end))
    i = end
  }
  throw invalid()
}

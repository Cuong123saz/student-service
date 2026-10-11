import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'

const maxBytes = 41 * 1024 * 1024
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const evidencePath = new RegExp('^minh-chung/[0-9]{3}-' + uuid + '\\.(pdf|png|jpg)$')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const failure = () => {
  throw new Error('BUNDLE_CHECK_FAILED')
}
export function inspectSubmissionBundle(bytes, expectedSha256) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes || bytes.length < 22) failure()
  const bundleSha256 = sha(bytes)
  if (
    expectedSha256 !== undefined &&
    (!/^[a-f0-9]{64}$/.test(expectedSha256) || expectedSha256 !== bundleSha256)
  )
    failure()
  const names = new Set()
  let total = 0
  const parts = unzipSync(bytes, {
    filter: (file) => {
      // The server emits stored ZIP entries only. Do not inflate untrusted data.
      if (
        names.has(file.name) ||
        names.size >= 154 ||
        file.compression !== 0 ||
        file.size !== file.originalSize
      )
        failure()
      if (
        !['manifest.json', 'HUONG-DAN.txt', 'phieu-ho-so.docx', 'phieu-ho-so.pdf'].includes(
          file.name,
        ) &&
        !evidencePath.test(file.name)
      )
        failure()
      names.add(file.name)
      total += file.originalSize
      if (
        total > maxBytes ||
        (file.name === 'manifest.json' && file.originalSize > 128 * 1024) ||
        (file.name === 'HUONG-DAN.txt' && file.originalSize > 16 * 1024)
      )
        failure()
      return true
    },
  })
  const manifest = JSON.parse(strFromU8(parts['manifest.json'] ?? new Uint8Array()))
  if (
    manifest.schema !== 'student-service.submission-bundle' ||
    manifest.version !== 1 ||
    manifest.integrityAlgorithm !== 'SHA-256' ||
    manifest.documentStatus !== 'UNSIGNED_DECLARATION' ||
    manifest.signatureStatus !== 'NOT_CHECKED' ||
    !new RegExp('^' + uuid + '$').test(manifest.submissionId) ||
    !Number.isSafeInteger(manifest.roundNumber) ||
    manifest.roundNumber < 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== names.size - 1 ||
    !manifest.template ||
    typeof manifest.template.id !== 'string' ||
    !/^submission-summary-v[1-9][0-9]*$/.test(manifest.template.id) ||
    !/^[a-f0-9]{64}$/.test(manifest.template.sha256)
  )
    failure()
  const listed = new Set()
  for (const item of manifest.files) {
    if (
      !item ||
      typeof item.path !== 'string' ||
      item.path === 'manifest.json' ||
      listed.has(item.path) ||
      !Object.hasOwn(parts, item.path) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      failure()
    listed.add(item.path)
    const content = parts[item.path]
    if (content.length !== item.size || sha(content) !== item.sha256) failure()
    if (evidencePath.test(item.path)) {
      const extension = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[
        item.mimeType
      ]
      if (
        item.kind !== 'EVIDENCE' ||
        item.signatureStatus !== 'NOT_CHECKED' ||
        !extension ||
        !item.path.endsWith('-' + item.fileId + '.' + extension) ||
        !new RegExp('^' + uuid + '$').test(item.fileId) ||
        typeof item.originalName !== 'string' ||
        typeof item.attachmentKey !== 'string'
      )
        failure()
    } else {
      const expected = {
        'phieu-ho-so.docx': [
          'DECLARATION_WORD',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        'phieu-ho-so.pdf': ['DECLARATION_PDF', 'application/pdf'],
        'HUONG-DAN.txt': ['INSTRUCTIONS', 'text/plain; charset=utf-8'],
      }[item.path]
      if (!expected || item.kind !== expected[0] || item.mimeType !== expected[1]) failure()
    }
  }
  for (const name of ['phieu-ho-so.docx', 'phieu-ho-so.pdf', 'HUONG-DAN.txt'])
    if (!listed.has(name)) failure()
  return {
    result: 'CHECKSUMS_MATCH_UNSIGNED',
    bundleSha256,
    comparedWithExternalHash: expectedSha256 !== undefined,
    submissionId: manifest.submissionId,
    roundNumber: manifest.roundNumber,
    fileCount: listed.size,
    templateId: manifest.template.id,
    signatureStatus: 'NOT_CHECKED',
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [path, flag, expectedSha256, ...rest] = process.argv.slice(2)
    if (
      !path ||
      rest.length ||
      (flag !== undefined && flag !== '--sha256') ||
      (flag && !expectedSha256)
    )
      throw new Error('USAGE')
    const handle = await open(path, 'r')
    let bytes
    try {
      const details = await handle.stat()
      if (!details.isFile() || details.size > maxBytes) failure()
      const buffer = Buffer.alloc(details.size + 1)
      let offset = 0
      while (offset < buffer.length) {
        const chunk = await handle.read(buffer, offset, buffer.length - offset, null)
        if (!chunk.bytesRead) break
        offset += chunk.bytesRead
      }
      if (offset !== details.size) failure()
      bytes = buffer.subarray(0, offset)
    } finally {
      await handle.close()
    }
    const result = inspectSubmissionBundle(bytes, expectedSha256)
    console.log(JSON.stringify(result, null, 2))
    console.log(
      'Các mã kiểm tra khớp. Đây là bản kê khai chưa ký; chưa xác minh nguồn phát hành hoặc hiệu lực pháp lý.',
    )
  } catch (error) {
    console.error(
      error.message === 'USAGE'
        ? 'Dùng: npm run bundle:verify -- <đường-dẫn-gói.zip> [--sha256 <mã-băm-đã-lưu-riêng>]'
        : 'Không kiểm tra được gói hồ sơ hoặc mã kiểm tra không khớp. Tệp không bị giải nén hay thay đổi.',
    )
    process.exitCode = 1
  }
}

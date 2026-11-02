import { describe, it, expect } from 'vitest'
import {
  blobSha256,
  isSha256,
  panelExportFormats,
  trainingExportFileName,
  trainingExportFormats,
} from '../../app/utils/training-export'

describe('training export helpers', () => {
  it('builds file names only from a validated snapshot UUID', () => {
    const id = '10000000-0000-4000-8000-00000000000A'
    expect(trainingExportFileName('zip', id)).toBe(
      'training-export-10000000-0000-4000-8000-00000000000a.zip',
    )
    expect(trainingExportFileName('pdf', id)).toMatch(/^training-minutes-.*\.pdf$/)
    expect(trainingExportFileName('xlsx', '../../etc/passwd')).toBe('training-points.xlsx')
    expect(trainingExportFileName('docx', '')).toBe('training-minutes.docx')
    // The class sheet key is not an extension: its file is still .xlsx.
    expect(trainingExportFileName('class-sheet', id)).toBe(
      'training-class-sheet-10000000-0000-4000-8000-00000000000a.xlsx',
    )
  })
  it('maps every format to its POST endpoint suffix', () => {
    expect(
      Object.fromEntries(Object.entries(trainingExportFormats).map(([k, v]) => [k, v.path])),
    ).toEqual({
      xlsx: 'export.xlsx',
      'class-sheet': 'class-sheet.xlsx',
      docx: 'minutes.docx',
      pdf: 'minutes.pdf',
      zip: 'export.zip',
      'form-docx': 'form.docx',
      'form-pdf': 'form.pdf',
    })
  })
  it('lets the class monitor export only the class sheet from the panel', () => {
    expect(panelExportFormats.MONITOR).toEqual(['class-sheet'])
    expect(panelExportFormats.ADVISOR).not.toContain('form-docx')
  })
  it('accepts only lowercase 64-hex SHA-256 values', () => {
    expect(isSha256('a'.repeat(64))).toBe(true)
    expect(isSha256('A'.repeat(64))).toBe(false)
    expect(isSha256('a'.repeat(63))).toBe(false)
    expect(isSha256(null)).toBe(false)
  })
  it('hashes a blob with Web Crypto using the standard SHA-256 test vector', async () => {
    expect(await blobSha256(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

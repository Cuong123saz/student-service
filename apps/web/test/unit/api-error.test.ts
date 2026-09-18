import { describe, expect, it } from 'vitest'

import { getApiErrorContext } from '../../app/utils/api-error'

describe('getApiErrorContext', () => {
  it('đọc structured error từ data của $fetch', () => {
    const context = getApiErrorContext({
      statusCode: 409,
      data: {
        message: 'Safe message',
        error: {
          code: 'IMPORT_COMMIT_CONFLICT',
          requestId: 'req-42',
        },
      },
    })

    expect(context).toEqual({
      status: 409,
      code: 'IMPORT_COMMIT_CONFLICT',
      requestId: 'req-42',
    })
  })

  it('đọc structured error từ response._data', () => {
    const context = getApiErrorContext({
      response: {
        status: 404,
        _data: {
          error: {
            code: 'IMPORT_PREVIEW_NOT_FOUND',
            requestId: 'req-43',
          },
        },
      },
    })

    expect(context).toEqual({
      status: 404,
      code: 'IMPORT_PREVIEW_NOT_FOUND',
      requestId: 'req-43',
    })
  })

  it('không tin tưởng giá trị lỗi không phải object', () => {
    expect(getApiErrorContext('network failed')).toEqual({})
  })
})

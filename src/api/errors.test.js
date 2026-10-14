import { AxiosError, CanceledError } from 'axios'
import { describe, expect, test } from 'vitest'
import { ERROR_STATUS, createErrorBody, parseApiError } from './errors'

// 构造与 axios 实际抛出结构一致的错误
const httpError = (status, data) =>
  new AxiosError('fail', 'ERR_BAD_RESPONSE', {}, {}, { status, data })

const errorFor = (code, message, extra) =>
  httpError(ERROR_STATUS[code], createErrorBody(code, message, extra))

describe('createErrorBody', () => {
  test('生成统一结构', () => {
    expect(
      createErrorBody('INVALID_ORDERS', '有不可续卡订单', {
        invalidOrders: [{ id: '1', orderNo: 'NO1', reason: '状态不是已到期' }],
      }),
    ).toEqual({
      code: 'INVALID_ORDERS',
      message: '有不可续卡订单',
      invalidOrders: [{ id: '1', orderNo: 'NO1', reason: '状态不是已到期' }],
    })
  })

  test('拒绝未定义的错误码', () => {
    expect(() => createErrorBody('NOPE', 'x')).toThrow('未知错误码')
  })

  test('状态码约定', () => {
    expect(ERROR_STATUS).toMatchObject({
      VALIDATION_ERROR: 400,
      UNAUTHORIZED: 401,
      VERSION_CONFLICT: 409,
      IDEMPOTENCY_CONFLICT: 409,
      INTERNAL_ERROR: 500,
    })
  })
})

describe('parseApiError', () => {
  test('取消请求', () => {
    expect(parseApiError(new CanceledError()).kind).toBe('cancelled')
  })

  test('401 为认证失效', () => {
    const e = parseApiError(errorFor('UNAUTHORIZED', '登录已失效'))
    expect(e).toMatchObject({ kind: 'unauthorized', status: 401 })
  })

  test('字段错误', () => {
    const e = parseApiError(
      errorFor('VALIDATION_ERROR', '参数错误', {
        fieldErrors: { phone: '请输入正确的 11 位手机号' },
      }),
    )
    expect(e).toMatchObject({
      kind: 'field',
      status: 400,
      fieldErrors: { phone: '请输入正确的 11 位手机号' },
    })
  })

  test('批量业务错误', () => {
    const invalidOrders = [{ id: '1', orderNo: 'NO1', reason: '状态不可撤单' }]
    const e = parseApiError(
      errorFor('INVALID_ORDERS', '有不可撤单订单', { invalidOrders }),
    )
    expect(e).toMatchObject({ kind: 'batch', invalidOrders })
  })

  test('版本冲突附带订单时按批量错误处理', () => {
    const e = parseApiError(
      errorFor('VERSION_CONFLICT', '订单已变化', {
        invalidOrders: [{ id: '1', orderNo: 'NO1', reason: '订单已被修改' }],
      }),
    )
    expect(e).toMatchObject({
      kind: 'batch',
      status: 409,
      code: 'VERSION_CONFLICT',
    })
  })

  test.each([
    ['IDEMPOTENCY_CONFLICT', 409],
    ['INTERNAL_ERROR', 500],
    ['VALIDATION_ERROR', 400], // 无 fieldErrors 的参数错误
  ])('%s 为普通错误', (code, status) => {
    const e = parseApiError(errorFor(code, '出错了'))
    expect(e).toMatchObject({
      kind: 'general',
      status,
      code,
      message: '出错了',
    })
  })

  test('无响应（网络错误）', () => {
    const e = parseApiError(new AxiosError('Network Error', 'ERR_NETWORK'))
    expect(e).toMatchObject({
      kind: 'general',
      status: null,
      message: '网络异常，请稍后重试',
    })
  })

  test('响应体不符合契约时使用状态码提示', () => {
    expect(parseApiError(httpError(502, '<html>')).message).toBe(
      '请求失败（502）',
    )
  })

  test('非 axios 错误不抛异常', () => {
    expect(parseApiError(new Error('boom')).kind).toBe('general')
    expect(parseApiError(undefined).kind).toBe('general')
  })
})

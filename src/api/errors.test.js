import { AxiosError, CanceledError } from 'axios'
import { describe, expect, test } from 'vitest'
import { ERROR_STATUS, createErrorBody, parseApiError } from './errors'

// 构造与 axios 实际抛出结构一致的错误
const httpError = (status, data) =>
  new AxiosError('fail', 'ERR_BAD_RESPONSE', {}, {}, { status, data })

const errorFor = (code, message, extra) =>
  httpError(ERROR_STATUS[code], createErrorBody(code, message, extra))

// 初始数据中的真实订单
const CANCELLED_ZHENGKAI = {
  id: 'o-016',
  orderNo: 'FM20260719001',
  reason: '订单状态为「已取消」，仅已到期订单可续卡',
}
const COMPLETED_ZHANGWEI = {
  id: 'o-010',
  orderNo: 'FM20251108001',
  reason: '订单状态为「已完成」，仅待制卡、待寄卡订单可撤单',
}

describe('createErrorBody', () => {
  test('生成统一结构', () => {
    expect(
      createErrorBody('INVALID_ORDERS', '所选订单中有 1 笔不可续卡', {
        invalidOrders: [CANCELLED_ZHENGKAI],
      }),
    ).toEqual({
      code: 'INVALID_ORDERS',
      message: '所选订单中有 1 笔不可续卡',
      invalidOrders: [CANCELLED_ZHENGKAI],
    })
  })

  test('拒绝契约外的错误码', () => {
    expect(() => createErrorBody('PERMISSION_DENIED', '无操作权限')).toThrow(
      '未知错误码',
    )
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
    const e = parseApiError(errorFor('UNAUTHORIZED', '登录已失效，请重新登录'))
    expect(e).toMatchObject({ kind: 'unauthorized', status: 401 })
  })

  test('字段错误', () => {
    const e = parseApiError(
      errorFor('VALIDATION_ERROR', '订单信息填写有误', {
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
    const invalidOrders = [COMPLETED_ZHANGWEI]
    const e = parseApiError(
      errorFor('INVALID_ORDERS', '所选订单中有 1 笔不可撤单', {
        invalidOrders,
      }),
    )
    expect(e).toMatchObject({ kind: 'batch', invalidOrders })
  })

  test('版本冲突附带订单时按批量错误处理', () => {
    const e = parseApiError(
      errorFor('VERSION_CONFLICT', '订单已被修改，请刷新后重试', {
        invalidOrders: [
          {
            id: 'o-005',
            orderNo: 'FM20190309001',
            reason: '订单已被其他人修改，请刷新后重试',
          },
        ],
      }),
    )
    expect(e).toMatchObject({
      kind: 'batch',
      status: 409,
      code: 'VERSION_CONFLICT',
    })
  })

  test.each([
    ['IDEMPOTENCY_CONFLICT', 409, '重复提交的请求与首次提交内容不一致'],
    ['INTERNAL_ERROR', 500, '服务异常，请稍后重试'],
    ['VALIDATION_ERROR', 400, '每页数量只能是 10、20 或 50'], // 无 fieldErrors
  ])('%s 为普通错误', (code, status, message) => {
    const e = parseApiError(errorFor(code, message))
    expect(e).toMatchObject({ kind: 'general', status, code, message })
  })

  test('无响应（网络错误）', () => {
    const e = parseApiError(new AxiosError('Network Error', 'ERR_NETWORK'))
    expect(e).toMatchObject({
      kind: 'general',
      status: null,
      message: '网络异常，请稍后重试',
    })
  })

  test('网关返回 HTML 错误页时使用状态码提示', () => {
    const nginx502 =
      '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>'
    expect(parseApiError(httpError(502, nginx502)).message).toBe(
      '请求失败（502）',
    )
  })

  test('页面代码自身的异常不会让解析失败', () => {
    const bug = new TypeError(
      "Cannot read properties of undefined (reading 'items')",
    )
    expect(parseApiError(bug).kind).toBe('general')
    expect(parseApiError(undefined).kind).toBe('general')
  })
})

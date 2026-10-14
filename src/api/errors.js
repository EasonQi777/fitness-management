// 接口错误契约：模拟服务用 createErrorBody 生成错误，页面与请求层用 parseApiError 解析。
// 错误响应体统一为 { code, message, fieldErrors?, invalidOrders? }

import { isCancel } from 'axios'

/** 错误码 → HTTP 状态码 */
export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400, // 参数错误；表单类错误附带 fieldErrors
  INVALID_ORDERS: 400, // 批量操作中有不合格订单，附带 invalidOrders
  UNAUTHORIZED: 401, // 未登录或 token 无效
  NOT_FOUND: 404, // 接口不存在
  VERSION_CONFLICT: 409, // 订单版本已变化，附带 invalidOrders
  IDEMPOTENCY_CONFLICT: 409, // 同一幂等键对应了不同的请求参数
  INTERNAL_ERROR: 500, // 模拟服务错误
})

/**
 * @typedef {{ id: string, orderNo: string|null, reason: string }} InvalidOrder
 * @typedef {{ code: keyof typeof ERROR_STATUS, message: string,
 *   fieldErrors?: Record<string, string>, invalidOrders?: InvalidOrder[] }} ErrorBody
 */

/**
 * 生成统一错误响应体
 * @param {keyof typeof ERROR_STATUS} code
 * @param {string} message
 * @param {{ fieldErrors?: Record<string, string>, invalidOrders?: InvalidOrder[] }} [extra]
 * @returns {ErrorBody}
 */
export function createErrorBody(code, message, extra = {}) {
  if (!(code in ERROR_STATUS)) throw new Error(`未知错误码：${code}`)
  return { code, message, ...extra }
}

/**
 * 将请求失败解析为页面可处理的结构。kind：
 * - cancelled：请求被取消，不提示
 * - unauthorized：认证失效，由统一退出流程处理
 * - field：字段错误，显示在对应表单项
 * - batch：批量业务错误，列出不合格订单
 * - general：其他错误，统一提示 message
 */
export function parseApiError(error) {
  if (isCancel(error)) return { kind: 'cancelled', message: '' }

  const status = error?.response?.status ?? null
  const body = error?.response?.data
  const hasBody = body && typeof body.message === 'string'
  const fieldErrors = hasBody ? (body.fieldErrors ?? {}) : {}
  const invalidOrders = hasBody ? (body.invalidOrders ?? []) : []

  let message
  if (hasBody) message = body.message
  else if (status) message = `请求失败（${status}）`
  else message = '网络异常，请稍后重试'

  let kind = 'general'
  if (status === 401) kind = 'unauthorized'
  else if (Object.keys(fieldErrors).length) kind = 'field'
  else if (invalidOrders.length) kind = 'batch'

  return {
    kind,
    status,
    code: hasBody ? body.code : null,
    message,
    fieldErrors,
    invalidOrders,
  }
}

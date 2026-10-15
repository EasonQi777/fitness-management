import { http } from './http'

/**
 * 查询订单列表。列表页在错误区域展示失败原因并提供重试，不使用请求层 toast。
 * @param {{ tab: string, orderNo: string, memberName: string, page: number, pageSize: number }} query
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ items: import('../domain/orderRules').Order[], total: number, page: number, pageSize: number }>}
 */
export const fetchOrders = (query, { signal } = {}) =>
  http
    .get('/orders', { params: query, signal, skipErrorToast: true })
    .then((res) => res.data)

/**
 * 新建订单
 * @param {{ memberName: string, phone: string, cardYears: number, remark?: string }} values
 * @param {{ idempotencyKey: string }} options 同一次提交意图使用同一个键，重试时复用
 * @returns {Promise<import('../domain/orderRules').Order>}
 */
export const createOrder = (values, { idempotencyKey }) =>
  http
    .post('/orders', values, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((res) => res.data)

/**
 * 续卡（单条与批量共用）
 * @param {{ orders: { id: string, version: number }[], years: number }} body
 * @param {{ idempotencyKey: string }} options
 * @returns {Promise<{ orders: import('../domain/orderRules').Order[], unitPrice: number, totalPrice: number }>}
 */
export const renewOrders = (body, { idempotencyKey }) =>
  http
    .post('/orders/renew', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((res) => res.data)

/**
 * 批量撤单
 * @param {{ orders: { id: string, version: number }[] }} body
 * @param {{ idempotencyKey: string }} options
 * @returns {Promise<{ orders: import('../domain/orderRules').Order[] }>}
 */
export const cancelOrders = (body, { idempotencyKey }) =>
  http
    .post('/orders/cancel', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((res) => res.data)

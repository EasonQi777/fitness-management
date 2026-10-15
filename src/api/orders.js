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

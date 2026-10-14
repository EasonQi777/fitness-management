// 内存数据库：页面刷新后模块重新加载，订单恢复为初始数据。

import { createSeedOrders } from './seed'

export const db = {
  /** @type {import('../domain/orderRules').Order[]} */
  orders: [],
}

/**
 * 重置为初始数据（或指定数据集）。仅供测试使用，页面不提供入口。
 * @param {import('../domain/orderRules').Order[]} [orders]
 */
export function resetMockDb(orders = createSeedOrders()) {
  db.orders = structuredClone(orders)
}

resetMockDb()

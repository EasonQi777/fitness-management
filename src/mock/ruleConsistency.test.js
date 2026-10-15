// 页面预检与接口最终校验一致：页面按 canRenew / canCancel 决定批量按钮是否可用，
// 绕过页面直接调用接口时，对演示数据中的每一笔订单都应得到相同结论。

import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseApiError } from '../api/errors'
import { canCancel, canRenew, ORDER_STATUS } from '../domain/orderStatus'
import { FRONT_DESK, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { resetMockDb } from './db'
import { createSeedOrders } from './seed'

const client = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(FRONT_DESK)}` },
})

let keySeq = 0
const newKey = () =>
  `2e8b4f6a-9c13-4d7e-b5a0-${String(++keySeq).padStart(12, '0')}`

/** 按订单号查出订单并提交写操作，返回是否成功 */
async function attempt(url, orderNo, extra = {}) {
  const [order] = (await client.get('/orders', { params: { orderNo } })).data
    .items
  try {
    await client.post(
      url,
      { orders: [{ id: order.id, version: order.version }], ...extra },
      { headers: { 'Idempotency-Key': newKey() } },
    )
    return true
  } catch (err) {
    expect(parseApiError(err)).toMatchObject({ code: 'INVALID_ORDERS' })
    return false
  }
}

const cases = createSeedOrders().map((o) => [
  o.orderNo,
  o.memberName,
  ORDER_STATUS[o.status].label,
  o.status,
])

beforeEach(() => resetMockDb())

describe.each(cases)('%s %s（%s）', (orderNo, _name, _label, status) => {
  test(`续卡：页面${canRenew(status) ? '可' : '不可'}选，接口结论一致`, async () => {
    expect(await attempt('/orders/renew', orderNo, { years: 1 })).toBe(
      canRenew(status),
    )
  })

  test(`撤单：页面${canCancel(status) ? '可' : '不可'}选，接口结论一致`, async () => {
    expect(await attempt('/orders/cancel', orderNo)).toBe(canCancel(status))
  })
})

test('演示数据覆盖全部六种状态', () => {
  expect(new Set(cases.map((c) => c[3]))).toEqual(
    new Set(Object.keys(ORDER_STATUS)),
  )
})

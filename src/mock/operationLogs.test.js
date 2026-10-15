// 操作日志：门店员工通过真实接口新建、续卡、撤单后，读取受保护的日志接口核对记录。

import axios from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { resetMockDb } from './db'

const adapter = createMockAdapter({ delay: 0 })
const clientOf = (user) =>
  axios.create({
    baseURL: '/api',
    adapter,
    headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {},
  })
const frontDesk = clientOf(FRONT_DESK)
const manager = clientOf(MANAGER)

let keySeq = 0
const newKey = () =>
  `7d3a9e5c-1f84-4b2a-9c6e-${String(++keySeq).padStart(12, '0')}`
const post = (url, body, { key = newKey(), as = frontDesk } = {}) =>
  as
    .post(url, body, { headers: { 'Idempotency-Key': key } })
    .then((r) => r.data)
const refs = (orders) => orders.map(({ id, version }) => ({ id, version }))
const logs = () => frontDesk.get('/operation-logs').then((r) => r.data.items)

async function find(memberName, tab) {
  const { items } = (
    await frontDesk.get('/orders', { params: { tab, memberName } })
  ).data
  expect(items).toHaveLength(1)
  return items[0]
}

const NOW = '2026-10-15T15:42:08+08:00'
beforeEach(() => {
  resetMockDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => vi.useRealTimers())

describe('成功操作写入日志', () => {
  test('前台新建订单：记录操作人、时间、订单号与状态', async () => {
    const order = await post('/orders', {
      memberName: '周雨桐',
      phone: '13816527409',
      cardYears: 5,
      remark: '朋友推荐，周末到店领卡',
    })
    expect(await logs()).toEqual([
      {
        id: 'log-1',
        action: 'create',
        operator: 'wangfang',
        operatedAt: new Date(NOW).toISOString(),
        orderId: order.id,
        orderNo: order.orderNo,
        fromStatus: null,
        toStatus: 'pending_review',
      },
    ])
  })

  test('批量续卡 5 年：每笔一条，续卡费用 4,800 与规则一致', async () => {
    const orders = await Promise.all(
      ['王建国', '李秀英', '陈志强'].map((n) => find(n, 'expired')),
    )
    await post('/orders/renew', { orders: refs(orders), years: 5 })

    const items = await logs()
    expect(items.map((l) => l.orderNo)).toEqual(orders.map((o) => o.orderNo))
    for (const log of items)
      expect(log).toMatchObject({
        action: 'renew',
        operator: 'wangfang',
        fromStatus: 'expired',
        toStatus: 'pending_review',
        renewYears: 5,
        renewFee: 4800,
      })
  })

  test.each([
    [4, 4800],
    [10, 9600],
  ])('续卡 %s 年：日志中的单笔费用为 %s', async (years, fee) => {
    const liu = await find('刘婷', 'expired')
    await post('/orders/renew', { orders: refs([liu]), years })
    expect((await logs())[0]).toMatchObject({
      renewYears: years,
      renewFee: fee,
    })
  })

  test('店长撤单：记录为店长操作，待制卡 → 已取消，无续卡费用', async () => {
    const cao = await find('曹宇', 'in_progress')
    await post('/orders/cancel', { orders: refs([cao]) }, { as: manager })

    const [log] = await logs()
    expect(log).toMatchObject({
      action: 'cancel',
      operator: 'lijun',
      orderNo: cao.orderNo,
      fromStatus: 'pending_card',
      toStatus: 'cancelled',
    })
    expect(log).not.toHaveProperty('renewFee')
  })

  test('日志按发生先后排列，编号连续', async () => {
    const wang = await find('王建国', 'expired')
    await post('/orders/renew', { orders: refs([wang]), years: 1 })
    const cao = await find('曹宇', 'in_progress')
    await post('/orders/cancel', { orders: refs([cao]) }, { as: manager })

    expect((await logs()).map((l) => [l.id, l.action, l.operator])).toEqual([
      ['log-1', 'renew', 'wangfang'],
      ['log-2', 'cancel', 'lijun'],
    ])
  })
})

describe('失败与重放不写日志', () => {
  test('勾选中混入已完成订单，整批续卡被拒：没有任何日志', async () => {
    const wang = await find('王建国', 'expired')
    const zhang = await find('张伟', 'completed')
    await post('/orders/renew', {
      orders: refs([wang, zhang]),
      years: 2,
    }).catch(() => {})
    expect(await logs()).toEqual([])
  })

  test('店长已先撤单，前台用旧版本再撤：只有店长那一条', async () => {
    const xu = await find('徐明', 'in_progress')
    await post('/orders/cancel', { orders: refs([xu]) }, { as: manager })
    await post('/orders/cancel', { orders: refs([xu]) }).catch(() => {})
    expect((await logs()).map((l) => l.operator)).toEqual(['lijun'])
  })

  test('新建时手机号填错被拒：没有日志', async () => {
    await post('/orders', {
      memberName: '周雨桐',
      phone: '138-1652-7409',
      cardYears: 1,
    }).catch(() => {})
    expect(await logs()).toEqual([])
  })

  test('网络超时后用同一个幂等键重试续卡：只有一条日志', async () => {
    const wang = await find('王建国', 'expired')
    const body = { orders: refs([wang]), years: 3 }
    const key = newKey()
    await post('/orders/renew', body, { key })
    await post('/orders/renew', body, { key })
    expect(await logs()).toHaveLength(1)
  })
})

test('未登录不能读取日志', async () => {
  const e = await clientOf(null).get('/operation-logs').catch(parseApiError)
  expect(e.kind).toBe('unauthorized')
})

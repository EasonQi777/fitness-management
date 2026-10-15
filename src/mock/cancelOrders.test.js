import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
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

// 每次提交意图一个幂等键（页面中由 crypto.randomUUID 生成）
let keySeq = 0
const newKey = () =>
  `4b7e2c91-3d5a-4f80-b6e2-${String(++keySeq).padStart(12, '0')}`

const cancel = (orders, { key = newKey(), as = frontDesk } = {}) =>
  as
    .post(
      '/orders/cancel',
      { orders: orders.map(({ id, version }) => ({ id, version })) },
      { headers: { 'Idempotency-Key': key } },
    )
    .then((r) => r.data)
const failCancel = (orders, options) =>
  cancel(orders, options).then(
    () => expect.fail('应当失败'),
    (e) => parseApiError(e),
  )
const list = (params) =>
  frontDesk.get('/orders', { params }).then((r) => r.data)

/** 与员工操作一致：在指定 Tab 下按会员姓名搜索，取出该订单 */
async function find(memberName, tab = 'all') {
  const { items } = await list({ tab, memberName })
  expect(items).toHaveLength(1)
  return items[0]
}
/** 按订单号重新查询，核对撤单后的结果 */
const reload = async ({ orderNo }) => (await list({ orderNo })).items[0]

beforeEach(() => resetMockDb())

describe('撤单', () => {
  test('待制卡的曹宇撤单：变为已取消、版本加 1，金额、年限与创建时间不变', async () => {
    const cao = await find('曹宇', 'in_progress')
    expect(cao).toMatchObject({ status: 'pending_card', version: 1 })

    const res = await cancel([cao])

    const expected = { ...cao, status: 'cancelled', version: 2 }
    expect(res).toEqual({ orders: [expected] })
    expect(await reload(cao)).toEqual(expected)
  })

  test('待寄卡的黄丽撤单：变为已取消', async () => {
    const huang = await find('黄丽', 'in_progress')
    expect(huang.status).toBe('pending_shipping')
    await cancel([huang])
    expect(await reload(huang)).toMatchObject({
      status: 'cancelled',
      amount: 2400,
      cardYears: 2,
    })
  })

  test('金额待财务确认的潘越撤单后，金额仍为空', async () => {
    const pan = await find('潘越', 'in_progress')
    await cancel([pan])
    expect(await reload(pan)).toMatchObject({
      status: 'cancelled',
      amount: null,
    })
  })

  test('夫妻同办的袁志远、袁思琪一起撤单：进行中少两笔，已取消中可查到', async () => {
    const couple = (await list({ tab: 'in_progress', memberName: '袁' })).items
    expect(couple).toHaveLength(2)
    const res = await cancel(couple)
    expect(res.orders.map((o) => o.status)).toEqual(['cancelled', 'cancelled'])

    expect((await list({ tab: 'in_progress' })).total).toBe(16)
    const cancelled = await list({ tab: 'cancelled', memberName: '袁' })
    expect(cancelled.items.map((o) => o.memberName)).toEqual([
      '袁志远',
      '袁思琪',
    ])
  })
})

describe('拒绝与原子性', () => {
  test.each([
    ['已完成', '张伟', 'completed'],
    ['待审核', '薛刚', 'in_progress'],
    ['已到期', '王建国', 'expired'],
    ['已取消', '郑凯', 'cancelled'],
  ])('%s订单（%s）不可撤单，订单不变', async (label, name, tab) => {
    const order = await find(name, tab)
    const e = await failCancel([order])
    expect(e).toMatchObject({ kind: 'batch', code: 'INVALID_ORDERS' })
    expect(e.invalidOrders).toEqual([
      {
        id: order.id,
        orderNo: order.orderNo,
        reason: `订单状态为「${label}」，仅待制卡、待寄卡订单可撤单`,
      },
    ])
    expect(await reload(order)).toEqual(order)
  })

  test('彭飞、宋雨桐中混入待审核的蒋欣：整批失败，只列出蒋欣，三笔都不变', async () => {
    const peng = await find('彭飞', 'in_progress') // 待制卡
    const song = await find('宋雨桐', 'in_progress') // 待寄卡
    const jiang = await find('蒋欣', 'in_progress') // 待审核

    const e = await failCancel([peng, song, jiang])

    expect(e.invalidOrders.map((o) => o.orderNo)).toEqual([jiang.orderNo])
    for (const o of [peng, song, jiang]) expect(await reload(o)).toEqual(o)
  })

  test('店长已先为徐明撤单，前台用打开列表时的版本提交：409，版本只加一次', async () => {
    const seenByFrontDesk = await find('徐明', 'in_progress')
    await cancel([seenByFrontDesk], { as: manager })

    const e = await failCancel([seenByFrontDesk])
    expect(e).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    expect(e.invalidOrders.map((o) => o.orderNo)).toEqual([
      seenByFrontDesk.orderNo,
    ])
    expect(await reload(seenByFrontDesk)).toMatchObject({
      status: 'cancelled',
      version: 2,
    })
  })

  test('未登录返回 401，订单不变', async () => {
    const cao = await find('曹宇', 'in_progress')
    const e = await failCancel([cao], { as: clientOf(null) })
    expect(e.kind).toBe('unauthorized')
    expect(await reload(cao)).toEqual(cao)
  })
})

test('网络超时后用同一个幂等键重试：返回首次结果，版本只加一次', async () => {
  const han = await find('韩磊', 'in_progress')
  const key = newKey()
  const first = await cancel([han], { key })
  const retry = await cancel([han], { key })
  expect(retry).toEqual(first)
  expect(await reload(han)).toMatchObject({ status: 'cancelled', version: 2 })
})

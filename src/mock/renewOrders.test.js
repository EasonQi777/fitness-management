// 续卡接口：以门店员工身份调用真实接口，按页面的方式查询订单、核对结果，不直接读写模拟数据库。

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
  `9e2a6f41-7c3d-4b8e-a15f-${String(++keySeq).padStart(12, '0')}`

const renew = (body, { key = newKey(), as = frontDesk } = {}) =>
  as
    .post('/orders/renew', body, { headers: { 'Idempotency-Key': key } })
    .then((r) => r.data)
const failRenew = (body, options) =>
  renew(body, options).then(
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
/** 按订单号重新查询，核对续卡后的结果 */
const reload = async ({ orderNo }) => (await list({ orderNo })).items[0]
const ref = ({ id, version }) => ({ id, version })

beforeEach(() => resetMockDb())

describe('续卡', () => {
  test('老会员欧阳晓峰累计 13 年，再续 5 年：变为 18 年、待审核，金额与创建时间不变', async () => {
    const before = await find('欧阳晓峰', 'expired')
    expect(before).toMatchObject({ cardYears: 13, amount: 6000, version: 4 })

    const res = await renew({ orders: [ref(before)], years: 5 })

    const expected = {
      ...before,
      cardYears: 18,
      status: 'pending_review',
      version: 5,
    }
    expect(res).toEqual({
      orders: [expected],
      unitPrice: 4800,
      totalPrice: 4800,
    })
    expect(await reload(before)).toEqual(expected)
  })

  test('王建国累计 5 年，续 3 年：变为 8 年，单笔 3,600 不打折', async () => {
    const wang = await find('王建国', 'expired')
    const res = await renew({ orders: [ref(wang)], years: 3 })
    expect(res).toMatchObject({ unitPrice: 3600, totalPrice: 3600 })
    expect(await reload(wang)).toMatchObject({ cardYears: 8, amount: 2400 })
  })

  test('刘婷续 4 年：单笔 4,800 不打折，原本缺失的金额仍为空', async () => {
    const liu = await find('刘婷', 'expired')
    const res = await renew({ orders: [ref(liu)], years: 4 })
    expect(res).toMatchObject({ unitPrice: 4800, totalPrice: 4800 })
    expect(await reload(liu)).toMatchObject({ cardYears: 6, amount: null })
  })

  test('三笔已到期订单各续 5 年：单笔 4,800，总价 14,400', async () => {
    const orders = await Promise.all(
      ['王建国', '李秀英', '陈志强'].map((n) => find(n, 'expired')),
    )
    const res = await renew({ orders: orders.map(ref), years: 5 })
    expect(res).toMatchObject({ unitPrice: 4800, totalPrice: 14400 })
    expect(res.orders.map((o) => o.cardYears)).toEqual([10, 8, 6])
    // 员工福利卡金额为 0，续卡后仍为 0
    expect((await reload(orders[2])).amount).toBe(0)
  })

  test('续卡后从已到期 Tab 消失，在进行中可查到', async () => {
    const wang = await find('王建国', 'expired')
    await renew({ orders: [ref(wang)], years: 1 })

    const expired = await list({ tab: 'expired' })
    expect(expired.total).toBe(5)
    expect(expired.items.map((o) => o.memberName)).not.toContain('王建国')
    expect(await find('王建国', 'in_progress')).toMatchObject({
      status: 'pending_review',
      cardYears: 6,
    })
  })
})

describe('拒绝与原子性', () => {
  test('勾选中混入已完成、待审核订单：整批失败并列出订单号，三笔都不变', async () => {
    const wang = await find('王建国', 'expired')
    const zhang = await find('张伟', 'completed')
    const xue = await find('薛刚', 'in_progress') // 待审核

    const e = await failRenew({
      orders: [wang, zhang, xue].map(ref),
      years: 2,
    })

    expect(e).toMatchObject({ kind: 'batch', code: 'INVALID_ORDERS' })
    expect(e.invalidOrders).toEqual([
      {
        id: zhang.id,
        orderNo: zhang.orderNo,
        reason: '订单状态为「已完成」，仅已到期订单可续卡',
      },
      {
        id: xue.id,
        orderNo: xue.orderNo,
        reason: '订单状态为「待审核」，仅已到期订单可续卡',
      },
    ])
    for (const o of [wang, zhang, xue]) expect(await reload(o)).toEqual(o)
  })

  test('店长已先为李秀英续卡，前台用打开列表时的版本提交：409，不会再续一次', async () => {
    const seenByFrontDesk = await find('李秀英', 'expired')
    await renew({ orders: [ref(seenByFrontDesk)], years: 1 }, { as: manager })

    const e = await failRenew({ orders: [ref(seenByFrontDesk)], years: 1 })
    expect(e).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' })
    expect(e.invalidOrders.map((o) => o.orderNo)).toEqual([
      seenByFrontDesk.orderNo,
    ])
    expect((await reload(seenByFrontDesk)).cardYears).toBe(4)
  })

  // 绕过页面直接调用接口时，服务端仍按同一规则拦截
  test.each([
    ['年限为 0', 0],
    ['年限为 11', 11],
    ['年限为小数', 2.5],
    ['年限未转换为数字', '5'],
    ['缺少年限', undefined],
  ])('%s：400 字段错误，订单不变', async (_, years) => {
    const wang = await find('王建国', 'expired')
    const e = await failRenew({ orders: [ref(wang)], years })
    expect(e).toMatchObject({ kind: 'field', status: 400 })
    expect(Object.keys(e.fieldErrors)).toEqual(['years'])
    expect(await reload(wang)).toEqual(wang)
  })

  test('未登录返回 401，订单不变', async () => {
    const wang = await find('王建国', 'expired')
    const e = await failRenew(
      { orders: [ref(wang)], years: 1 },
      { as: clientOf(null) },
    )
    expect(e.kind).toBe('unauthorized')
    expect(await reload(wang)).toEqual(wang)
  })
})

test('网络超时后用同一个幂等键重试：返回首次结果，年限只增加一次', async () => {
  const wang = await find('王建国', 'expired')
  const body = { orders: [ref(wang)], years: 3 }
  const key = newKey()
  const first = await renew(body, { key })
  const retry = await renew(body, { key })
  expect(retry).toEqual(first)
  expect(await reload(wang)).toMatchObject({ cardYears: 8, version: 3 })
})

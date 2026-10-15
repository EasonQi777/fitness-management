// 导出预览接口：以门店员工身份调用真实接口，按页面的方式取得筛选条件与勾选的订单。

import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { createBulkTestOrders } from './bulkSeed'
import { resetMockDb } from './db'

const adapter = createMockAdapter({ delay: 0 })
const clientOf = (user) =>
  axios.create({
    baseURL: '/api',
    adapter,
    headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {},
  })
const frontDesk = clientOf(FRONT_DESK)

const preview = (body, as = frontDesk) =>
  as.post('/orders/export-preview', body).then((r) => r.data)
const failPreview = (body, as) =>
  preview(body, as).then(
    () => expect.fail('应当失败'),
    (e) => parseApiError(e),
  )
const list = (params) =>
  frontDesk.get('/orders', { params }).then((r) => r.data)
const names = (items) => items.map((o) => o.memberName)
const filtered = (filters) => preview({ scope: 'filtered', filters })

// 演示数据中的已完成与已到期订单（创建时间降序）
const EXPORTABLE = [
  '孙浩',
  '吴佳琪',
  '周文斌',
  '赵雪梅',
  'David Miller',
  '张伟',
  '刘婷',
  '陈志强',
  '阿依古丽·买买提',
  '李秀英',
  '王建国',
  '欧阳晓峰',
]

beforeEach(() => resetMockDb())

describe('导出筛选结果', () => {
  test('全部订单：可导出 12 笔已完成 / 已到期，其余 24 笔列出原因', async () => {
    const res = await filtered({ tab: 'all' })
    expect(names(res.items)).toEqual(EXPORTABLE)
    expect(res.excluded).toHaveLength(24)
    expect(res.excluded[0]).toEqual({
      id: expect.any(String),
      orderNo: 'FM20261014001',
      reason: '订单状态为「待审核」，仅已完成、已到期订单可导出',
    })
  })

  test('只返回对账字段，不含手机号和备注', async () => {
    const { items } = await filtered({ tab: 'expired', memberName: '刘婷' })
    expect(items).toEqual([
      {
        id: expect.any(String),
        orderNo: 'FM20230427001',
        memberName: '刘婷',
        cardYears: 2,
        amount: null,
        status: 'expired',
        createdAt: expect.any(String),
      },
    ])
  })

  test('“进行中”分组：没有可导出订单，18 笔全部被排除', async () => {
    const res = await filtered({ tab: 'in_progress' })
    expect(res.items).toEqual([])
    expect(res.excluded).toHaveLength(18)
  })

  test('与列表使用相同条件：订单号精确、姓名包含、去首尾空格、AND 关系', async () => {
    expect(
      names((await filtered({ tab: 'all', memberName: ' 王 ' })).items),
    ).toEqual(['王建国'])
    const both = await filtered({
      tab: 'all',
      orderNo: 'FM20190309001',
      memberName: '李',
    })
    expect(both).toEqual({ items: [], excluded: [] })
  })

  test('不受当前分页限制：已到期 15 笔超过一页，全部可导出', async () => {
    resetMockDb(createBulkTestOrders())
    const page1 = await list({ tab: 'expired' })
    expect(page1.items).toHaveLength(10)
    expect(page1.total).toBe(15)

    const res = await filtered({ tab: 'expired' })
    expect(res.items).toHaveLength(15)
    expect(res.excluded).toEqual([])
  })

  test('导出读取最新数据：王建国续卡后变为待审核，不再可导出', async () => {
    const [wang] = (await list({ tab: 'expired', memberName: '王建国' })).items
    await frontDesk.post(
      '/orders/renew',
      { orders: [{ id: wang.id, version: wang.version }], years: 1 },
      {
        headers: { 'Idempotency-Key': 'b9e2d7a3-4c61-4f08-9a5e-6d3c1f8b2e47' },
      },
    )
    const res = await filtered({ tab: 'all', memberName: '王建国' })
    expect(res.items).toEqual([])
    expect(res.excluded).toEqual([
      {
        id: wang.id,
        orderNo: wang.orderNo,
        reason: '订单状态为「待审核」，仅已完成、已到期订单可导出',
      },
    ])
  })
})

describe('导出勾选记录', () => {
  test('跨两页勾选的已到期订单全部进入导出', async () => {
    resetMockDb(createBulkTestOrders())
    const page1 = (await list({ tab: 'expired' })).items
    const page2 = (await list({ tab: 'expired', page: 2 })).items
    const picked = [page1[0], page1[9], page2[0], page2[4]]

    const res = await preview({
      scope: 'selected',
      ids: picked.map((o) => o.id),
    })
    expect(res.items.map((o) => o.orderNo)).toEqual(
      picked.map((o) => o.orderNo),
    )
    expect(res.excluded).toEqual([])
  })

  test('跨状态勾选：已到期、已完成可导出，待审核被排除并说明原因', async () => {
    const [wang] = (await list({ memberName: '王建国' })).items
    const [zhang] = (await list({ memberName: '张伟' })).items
    const [fan] = (await list({ memberName: '范思远' })).items

    const res = await preview({
      scope: 'selected',
      ids: [fan.id, wang.id, zhang.id],
    })
    expect(names(res.items)).toEqual(['张伟', '王建国'])
    expect(res.excluded).toEqual([
      {
        id: fan.id,
        orderNo: fan.orderNo,
        reason: '订单状态为「待审核」，仅已完成、已到期订单可导出',
      },
    ])
  })

  test('绕过页面传入不存在的 ID：列入排除并说明原因', async () => {
    const [wang] = (await list({ memberName: '王建国' })).items
    const res = await preview({ scope: 'selected', ids: [wang.id, 'o-999'] })
    expect(names(res.items)).toEqual(['王建国'])
    expect(res.excluded).toEqual([
      { id: 'o-999', orderNo: null, reason: '订单不存在' },
    ])
  })
})

describe('参数校验与认证', () => {
  test.each([
    ['未勾选订单', { scope: 'selected', ids: [] }, '请至少勾选一笔订单'],
    ['缺少 ids', { scope: 'selected' }, '请至少勾选一笔订单'],
    [
      '同一订单重复传入',
      { scope: 'selected', ids: ['o-005', 'o-006', 'o-005'] },
      '订单重复提交：o-005',
    ],
    ['ID 不是字符串', { scope: 'selected', ids: [5] }, '订单 ID 格式不正确'],
    ['导出当前页', { scope: 'page' }, '导出范围只能是 filtered 或 selected'],
    ['缺少范围', {}, '导出范围只能是 filtered 或 selected'],
    [
      '未知的状态分组',
      { scope: 'filtered', filters: { tab: 'refunded' } },
      '未知的订单状态分组',
    ],
    [
      '姓名不是文本',
      { scope: 'filtered', filters: { memberName: ['王'] } },
      '会员姓名格式不正确',
    ],
  ])('%s：400', async (_, body, message) => {
    expect(await failPreview(body)).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message,
    })
  })

  test('店长与前台使用同一导出规则', async () => {
    expect(
      await preview({ scope: 'filtered', filters: {} }, clientOf(MANAGER)),
    ).toEqual(await filtered({}))
  })

  test('未登录返回 401', async () => {
    const e = await failPreview(
      { scope: 'filtered', filters: { tab: 'all' } },
      clientOf(null),
    )
    expect(e.kind).toBe('unauthorized')
  })
})

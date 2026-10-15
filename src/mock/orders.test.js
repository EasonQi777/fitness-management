import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { createBulkTestOrders } from './bulkSeed'
import { db, resetMockDb } from './db'

// 以前台员工身份调用订单列表接口
const client = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(FRONT_DESK)}` },
})
const list = (params) => client.get('/orders', { params }).then((r) => r.data)
const failList = (params) =>
  client.get('/orders', { params }).then(
    () => expect.fail('应当失败'),
    (e) => parseApiError(e),
  )
const names = (res) => res.items.map((o) => o.memberName)

beforeEach(() => resetMockDb())

describe('状态分组', () => {
  test.each([
    ['all', 36],
    ['in_progress', 18],
    ['expired', 6],
    ['completed', 6],
    ['cancelled', 6],
  ])('%s 共 %s 条', async (tab, total) => {
    expect((await list({ tab })).total).toBe(total)
  })

  test('不传 tab 时为全部', async () => {
    expect((await list()).total).toBe(36)
  })

  test('“进行中”只包含待审核、待制卡、待寄卡', async () => {
    const { items } = await list({ tab: 'in_progress', pageSize: 50 })
    expect(new Set(items.map((o) => o.status))).toEqual(
      new Set(['pending_review', 'pending_card', 'pending_shipping']),
    )
  })
})

describe('搜索', () => {
  test('订单号精确匹配', async () => {
    const res = await list({ orderNo: 'FM20261009002' })
    expect(names(res)).toEqual(['袁思琪'])
  })

  test('只输入订单号前缀查不到（不做模糊匹配）', async () => {
    expect((await list({ orderNo: 'FM20261009' })).total).toBe(0)
  })

  test('会员姓名包含匹配', async () => {
    expect(names(await list({ memberName: '袁' }))).toEqual([
      '袁志远',
      '袁思琪',
    ])
  })

  test('英文姓名不区分大小写', async () => {
    expect(names(await list({ memberName: 'david' }))).toEqual(['David Miller'])
  })

  test('从聊天记录复制的订单号和姓名带空格，与去空格后的结果一致', async () => {
    expect(names(await list({ orderNo: ' FM20261009002 ' }))).toEqual([
      '袁思琪',
    ])
    expect((await list({ memberName: '  袁 ' })).total).toBe(2)
  })

  test('空白的搜索条件视为未填写', async () => {
    expect((await list({ orderNo: '  ', memberName: '' })).total).toBe(36)
  })

  test('多个条件同时生效（AND）', async () => {
    expect((await list({ tab: 'in_progress', memberName: '袁' })).total).toBe(2)
    expect((await list({ tab: 'expired', memberName: '袁' })).total).toBe(0)
    expect(
      (await list({ memberName: '袁', orderNo: 'FM20261009001' })).items[0]
        .memberName,
    ).toBe('袁志远')
  })

  test('无匹配时返回空数组与 0，按第一页返回', async () => {
    expect(await list({ memberName: '诸葛' })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    })
  })
})

describe('排序', () => {
  // 存储顺序不代表展示顺序（如订单被修改后重新写入），排序不能依赖它
  beforeEach(() => db.orders.reverse())

  test('最新创建的订单在最前', async () => {
    const { items } = await list({ pageSize: 50 })
    expect(items[0].memberName).toBe('范思远')
    const times = items.map((o) => o.createdAt)
    expect(times).toEqual([...times].sort().reverse())
  })

  test('创建时间相同时按 ID 升序，结果稳定', async () => {
    const { items } = await list({ memberName: '袁' })
    expect(items[0].createdAt).toBe(items[1].createdAt)
    expect(items.map((o) => o.id)).toEqual(['o-029', 'o-030'])
  })
})

describe('分页', () => {
  test('默认第 1 页、每页 10 条，total 为分页前的总数', async () => {
    const res = await list()
    expect(res).toMatchObject({ total: 36, page: 1, pageSize: 10 })
    expect(res.items).toHaveLength(10)
  })

  test('翻到最后一页只返回剩余记录', async () => {
    expect((await list({ page: 4 })).items).toHaveLength(6)
  })

  test.each([
    [20, 2, 16],
    [50, 1, 36],
  ])('每页 %s 条，第 %s 页 %s 条', async (pageSize, page, count) => {
    const res = await list({ pageSize, page })
    expect(res.items).toHaveLength(count)
    expect(res.total).toBe(36)
  })

  test('各页拼接后与完整列表一致，无重复无遗漏', async () => {
    const pages = await Promise.all([1, 2, 3, 4].map((page) => list({ page })))
    const ids = pages.flatMap((p) => p.items.map((o) => o.id))
    expect(ids).toEqual((await list({ pageSize: 50 })).items.map((o) => o.id))
  })

  test('页码超出范围时返回空列表与真实总数', async () => {
    expect(await list({ page: 5 })).toMatchObject({
      items: [],
      total: 36,
      page: 5,
    })
  })
})

describe('参数校验', () => {
  test.each([
    ['页码为 0', { page: 0 }, '页码必须是正整数'],
    ['页码为负数', { page: -1 }, '页码必须是正整数'],
    ['页码为小数', { page: 1.5 }, '页码必须是正整数'],
    ['页码被手动改成文字', { page: 'last' }, '页码必须是正整数'],
    ['每页 15 条', { pageSize: 15 }, '每页数量只能是 10、20、50'],
    ['每页 1000 条', { pageSize: 1000 }, '每页数量只能是 10、20、50'],
    ['未知的分组', { tab: 'pending' }, '未知的订单状态分组'],
  ])('%s：返回 400', async (_, params, message) => {
    expect(await failList(params)).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message,
    })
  })

  test('未登录返回 401', async () => {
    const e = await axios
      .create({ baseURL: '/api', adapter: createMockAdapter({ delay: 0 }) })
      .get('/orders')
      .catch(parseApiError)
    expect(e.kind).toBe('unauthorized')
  })
})

describe('数据变化', () => {
  test('查询读取最新数据：订单撤单后出现在已取消分组', async () => {
    db.orders.find((o) => o.orderNo === 'FM20261006001').status = 'cancelled'
    const res = await list({ tab: 'cancelled', pageSize: 50 })
    expect(res.total).toBe(7)
    expect(names(res)).toContain('曹宇')
  })

  test('返回的是副本，修改响应不影响后续查询', async () => {
    const first = await list()
    first.items[0].status = 'cancelled'
    expect((await list()).items[0].status).toBe('pending_review')
  })
})

describe('批量测试数据集', () => {
  beforeEach(() => resetMockDb(createBulkTestOrders()))

  test('已到期 15 笔分两页：第 1 页 10 条，第 2 页 5 条', async () => {
    const first = await list({ tab: 'expired' })
    const second = await list({ tab: 'expired', page: 2 })
    expect(first.total).toBe(15)
    expect(first.items).toHaveLength(10)
    expect(second.items).toHaveLength(5)
    const ids = [...first.items, ...second.items].map((o) => o.id)
    expect(new Set(ids).size).toBe(15)
  })

  test('“进行中”包含 13 笔可撤单订单和 2 笔待审核，共两页', async () => {
    const res = await list({ tab: 'in_progress', pageSize: 50 })
    expect(res.total).toBe(15)
    expect(
      res.items.filter((o) =>
        ['pending_card', 'pending_shipping'].includes(o.status),
      ),
    ).toHaveLength(13)
  })
})

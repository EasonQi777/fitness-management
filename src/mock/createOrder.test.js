import axios from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { db, resetMockDb } from './db'

const adapter = createMockAdapter({ delay: 0 })
const client = axios.create({
  baseURL: '/api',
  adapter,
  headers: { Authorization: `Bearer ${tokenFor(FRONT_DESK)}` },
})

// 每次提交意图一个幂等键（页面中由 crypto.randomUUID 生成）
let keySeq = 0
const newKey = () =>
  `5b1d7c2e-4a90-4f3b-8c6d-${String(++keySeq).padStart(12, '0')}`

const create = (body, key = newKey()) =>
  client
    .post('/orders', body, { headers: { 'Idempotency-Key': key } })
    .then((r) => r.data)
const failCreate = (body, key = newKey()) =>
  create(body, key).then(
    () => expect.fail('应当失败'),
    (e) => parseApiError(e),
  )
const list = (params) => client.get('/orders', { params }).then((r) => r.data)

// 前台为新会员办理 5 年卡
const ZHOU = {
  memberName: '周雨桐',
  phone: '13816527409',
  cardYears: 5,
  remark: '朋友推荐，周末到店领卡',
}

beforeEach(() => {
  resetMockDb()
  // 只固定 Date，adapter 的定时器照常运行
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:30:12+08:00'))
})
afterEach(() => vi.useRealTimers())

describe('新建订单', () => {
  test('生成编号与创建时间，状态为待审核，版本 1，5 年卡 6000 元', async () => {
    expect(await create(ZHOU)).toEqual({
      id: 'o-037',
      orderNo: 'FM20261015001',
      memberName: '周雨桐',
      phone: '13816527409',
      cardYears: 5,
      amount: 6000,
      status: 'pending_review',
      createdAt: '2026-10-15T02:30:12.000Z',
      remark: '朋友推荐，周末到店领卡',
      version: 1,
    })
  })

  test('新订单可立即查到，并排在列表第一位', async () => {
    const order = await create(ZHOU)
    const res = await list()
    expect(res.total).toBe(37)
    expect(res.items[0]).toEqual(order)
    expect((await list({ orderNo: order.orderNo })).items).toEqual([order])
  })

  test('姓名与备注去首尾空格保存，未填备注保存为空字符串', async () => {
    const order = await create({
      memberName: '  周雨桐 ',
      phone: '13816527409',
      cardYears: 1,
    })
    expect(order).toMatchObject({ memberName: '周雨桐', remark: '' })
  })

  test.each([
    [1, 1200],
    [10, 12000],
  ])('%s 年卡金额为 %s 元（不打折）', async (cardYears, amount) => {
    expect((await create({ ...ZHOU, cardYears })).amount).toBe(amount)
  })

  test('不信任页面传入的金额、状态与编号', async () => {
    const order = await create({
      ...ZHOU,
      amount: 1,
      status: 'completed',
      id: 'o-001',
      orderNo: 'FM20130518001',
      version: 9,
      createdAt: '2020-01-01T00:00:00Z',
    })
    expect(order).toMatchObject({
      id: 'o-037',
      orderNo: 'FM20261015001',
      amount: 6000,
      status: 'pending_review',
      version: 1,
      createdAt: '2026-10-15T02:30:12.000Z',
    })
    // 被冒用编号的老订单不受影响
    expect(db.orders.find((o) => o.id === 'o-001').memberName).toBe('欧阳晓峰')
  })
})

describe('接口校验', () => {
  test('多个字段有误时返回全部字段错误，且不写入', async () => {
    const e = await failCreate({
      memberName: '周',
      phone: '1381652740',
      cardYears: 0,
      remark: '会员要求周末到店领取会员卡，需开具发票。'.repeat(11), // 220 字
    })
    expect(e).toMatchObject({ kind: 'field', status: 400 })
    expect(e.fieldErrors).toEqual({
      memberName: '会员姓名需为 2–30 个字符',
      phone: '请输入正确的 11 位手机号',
      cardYears: '年限需为 1–10 的整数',
      remark: '备注最多 200 字',
    })
    expect(db.orders).toHaveLength(36)
  })

  test.each([
    ['姓名只填了空格', { memberName: '   ' }, 'memberName'],
    ['手机号带分隔符', { phone: '138-1652-7409' }, 'phone'],
    ['年限 11', { cardYears: 11 }, 'cardYears'],
    ['年限为小数', { cardYears: 2.5 }, 'cardYears'],
    ['年限是字符串（未转换类型）', { cardYears: '5' }, 'cardYears'],
    ['缺少年限', { cardYears: undefined }, 'cardYears'],
  ])('%s：返回对应字段错误', async (_, patch, field) => {
    const e = await failCreate({ ...ZHOU, ...patch })
    expect(Object.keys(e.fieldErrors)).toEqual([field])
  })

  test('缺少幂等键返回 400', async () => {
    const e = await client.post('/orders', ZHOU).catch(parseApiError)
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    expect(db.orders).toHaveLength(36)
  })

  test('未登录返回 401', async () => {
    const e = await axios
      .create({ baseURL: '/api', adapter })
      .post('/orders', ZHOU, { headers: { 'Idempotency-Key': newKey() } })
      .catch(parseApiError)
    expect(e.kind).toBe('unauthorized')
  })
})

describe('重复提交', () => {
  test('网络超时后用同一个幂等键重试，只产生一笔订单', async () => {
    const key = newKey()
    const first = await create(ZHOU, key)
    const retry = await create(ZHOU, key)
    expect(retry).toEqual(first)
    expect(db.orders.filter((o) => o.phone === ZHOU.phone)).toHaveLength(1)
  })

  test('同一个幂等键改了内容再提交：409，不新增订单', async () => {
    const key = newKey()
    await create(ZHOU, key)
    const e = await failCreate({ ...ZHOU, cardYears: 3 }, key)
    expect(e).toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    expect(db.orders).toHaveLength(37)
  })

  test('同一秒内连续为三位会员新建，订单号与 ID 不重复', async () => {
    const orders = await Promise.all([
      create(ZHOU),
      create({ ...ZHOU, memberName: '钱佳宁', phone: '18621058743' }),
      create({ ...ZHOU, memberName: '孔德明', phone: '15900327618' }),
    ])
    expect(orders.map((o) => o.orderNo)).toEqual([
      'FM20261015001',
      'FM20261015002',
      'FM20261015003',
    ])
    expect(new Set(orders.map((o) => o.id)).size).toBe(3)
  })

  test('当天已有订单时序号接续', async () => {
    vi.setSystemTime(new Date('2026-10-14T19:05:00+08:00'))
    expect((await create(ZHOU)).orderNo).toBe('FM20261014002') // 已有 FM20261014001
  })

  test('跨过零点按上海日期编号', async () => {
    vi.setSystemTime(new Date('2026-10-15T23:59:59+08:00'))
    const late = await create(ZHOU)
    vi.setSystemTime(new Date('2026-10-16T00:00:01+08:00'))
    const next = await create({ ...ZHOU, phone: '18621058743' })
    expect([late.orderNo, next.orderNo]).toEqual([
      'FM20261015001',
      'FM20261016001',
    ])
  })
})

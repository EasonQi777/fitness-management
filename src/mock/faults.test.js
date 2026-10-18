// 异常场景：通过真实接口调用验证每种场景的效果，以及默认关闭时不会出现任何失败。

import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { resetMockDb } from './db'
import { faults, faultsFromEnv, setFaults } from './faults'

const client = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(FRONT_DESK)}` },
})
const list = (params) => client.get('/orders', { params }).then((r) => r.data)
const fail = (promise) =>
  promise.then(
    () => expect.fail('应当失败'),
    (e) => parseApiError(e),
  )
const logs = () => client.get('/operation-logs').then((r) => r.data.items)

let keySeq = 0
const newKey = () =>
  `5c1e8a3f-6d29-4b74-9e0a-${String(++keySeq).padStart(12, '0')}`
async function renewWang(key = newKey()) {
  const [wang] = (await list({ tab: 'expired', memberName: '王建国' })).items
  return client.post(
    '/orders/renew',
    { orders: [{ id: wang.id, version: wang.version }], years: 1 },
    { headers: { 'Idempotency-Key': key } },
  )
}

beforeEach(() => resetMockDb())

test('默认全部关闭：连续 50 次查询、写入都不会失败', async () => {
  expect(faults).toEqual({
    queryFailures: 0,
    writeFailures: 0,
    unauthorized: 0,
    slowQuery: null,
  })
  for (let i = 0; i < 50; i++) await list({ page: (i % 4) + 1 })
  await renewWang()
  expect(await logs()).toHaveLength(1)
})

describe('查询失败', () => {
  test('接下来 1 次列表查询返回 500，之后恢复', async () => {
    setFaults({ queryFailures: 1 })
    expect(await fail(list())).toMatchObject({
      status: 500,
      kind: 'general',
      message: '服务异常，请稍后重试',
    })
    expect((await list()).total).toBe(36)
  })

  test('只影响列表查询，导出预览和日志照常', async () => {
    setFaults({ queryFailures: 1 })
    const { data } = await client.post('/orders/export-preview', {
      scope: 'filtered',
      filters: { tab: 'expired' },
    })
    expect(data.items).toHaveLength(6)
    expect(await logs()).toEqual([])
    expect(faults.queryFailures).toBe(1) // 仍留给下一次列表查询
  })
})

describe('写入失败', () => {
  test('续卡返回 500：订单与日志都不变；用同一个幂等键重试成功', async () => {
    const key = newKey()
    setFaults({ writeFailures: 1 })
    expect(await fail(renewWang(key))).toMatchObject({ status: 500 })
    const [wang] = (await list({ memberName: '王建国' })).items
    expect(wang).toMatchObject({ status: 'expired', cardYears: 5, version: 2 })
    expect(await logs()).toEqual([])

    await renewWang(key)
    expect((await list({ memberName: '王建国' })).items[0]).toMatchObject({
      status: 'pending_review',
      cardYears: 6,
    })
    expect(await logs()).toHaveLength(1)
  })

  test('新建订单返回 500：不产生订单', async () => {
    setFaults({ writeFailures: 1 })
    await fail(
      client.post(
        '/orders',
        { memberName: '周雨桐', phone: '13816527409', cardYears: 1 },
        { headers: { 'Idempotency-Key': newKey() } },
      ),
    )
    expect((await list()).total).toBe(36)
  })
})

test('登录失效：接下来 1 次受保护请求返回 401，之后恢复', async () => {
  setFaults({ unauthorized: 1 })
  expect(await fail(list())).toMatchObject({
    status: 401,
    kind: 'unauthorized',
  })
  expect((await list()).total).toBe(36)
})

test('慢查询：只有姓名含关键词的列表查询变慢', async () => {
  setFaults({ slowQuery: { keyword: '袁', ms: 300 } })
  let start = performance.now()
  await list({ memberName: '袁' })
  expect(performance.now() - start).toBeGreaterThanOrEqual(290)

  start = performance.now()
  await list({ memberName: '王' })
  expect(performance.now() - start).toBeLessThan(150)
})

describe('环境变量解析', () => {
  test('完整配置', () => {
    expect(
      faultsFromEnv({
        VITE_MOCK_FAIL_QUERY: '2',
        VITE_MOCK_FAIL_WRITE: '1',
        VITE_MOCK_UNAUTHORIZED: '1',
        VITE_MOCK_SLOW_QUERY: '袁:3000',
      }),
    ).toEqual({
      queryFailures: 2,
      writeFailures: 1,
      unauthorized: 1,
      slowQuery: { keyword: '袁', ms: 3000 },
    })
  })

  test('未设置或写错时视为关闭', () => {
    expect(
      faultsFromEnv({
        VITE_MOCK_FAIL_QUERY: 'true',
        VITE_MOCK_FAIL_WRITE: '-1',
        VITE_MOCK_SLOW_QUERY: '袁',
      }),
    ).toEqual({
      queryFailures: 0,
      writeFailures: 0,
      unauthorized: 0,
      slowQuery: null,
    })
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import axios, { AxiosError, CanceledError } from 'axios'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { DEFAULT_QUERY } from '../domain/orderQuery'
import { createMockAdapter } from '../mock/adapter'
import { resetMockDb } from '../mock/db'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import { useOrders } from './useOrders'

const initial = useAuthStore.getState()

// 查询条件取自初始数据：姓名含“袁”的 2 笔（夫妻同办），已到期 6 笔
const BY_YUAN = { ...DEFAULT_QUERY, memberName: '袁' }
const EXPIRED = { ...DEFAULT_QUERY, tab: 'expired' }
// 已到期 Tab 的查询结果（创建时间降序）
const EXPIRED_NAMES = [
  '刘婷',
  '陈志强',
  '阿依古丽·买买提',
  '李秀英',
  '王建国',
  '欧阳晓峰',
]

// 以对应员工身份直接访问模拟服务（无网络延迟）
const clientOf = (user) =>
  axios.create({
    baseURL: '/api',
    adapter: createMockAdapter({ delay: 0 }),
    headers: { Authorization: `Bearer ${tokenFor(user)}` },
  })
const server = clientOf(FRONT_DESK)
const manager = clientOf(MANAGER)

/**
 * 替换 http.get：每次请求何时返回由测试决定，返回内容是模拟服务对该请求的真实响应。
 * honorAbort=false 模拟“响应已在途中、取消来不及”的情况。
 */
function controlledRequests({ honorAbort = true } = {}) {
  const calls = []
  vi.spyOn(http, 'get').mockImplementation((url, config) => {
    let resolve, reject
    const promise = new Promise((res, rej) => {
      resolve = async () =>
        res(await server.get(url, { params: config.params }))
      reject = rej
    })
    if (honorAbort)
      config.signal.addEventListener('abort', () => reject(new CanceledError()))
    calls.push({
      params: config.params,
      signal: config.signal,
      resolve,
      reject,
    })
    return promise
  })
  return calls
}

const serverError = () =>
  new AxiosError('fail', 'ERR_BAD_RESPONSE', {}, null, {
    status: 500,
    data: createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试'),
  })

const render = (query, { strict = false } = {}) =>
  renderHook(({ q }) => useOrders(q), {
    initialProps: { q: query },
    wrapper: strict ? StrictMode : undefined,
  })
const names = (current) => current.items.map((o) => o.memberName)

beforeEach(() => {
  resetMockDb()
  useAuthStore.setState(initial, true)
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
})
afterEach(() => vi.restoreAllMocks())

describe('通过真实 mock 加载', () => {
  test('首次加载第一页', async () => {
    const { result } = render(DEFAULT_QUERY)
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.total).toBe(36)
    expect(result.current.items).toHaveLength(10)
    expect(result.current.items[0].memberName).toBe('范思远')
  })

  test('refresh 按相同条件重新查询，看到最新数据', async () => {
    const { result } = render(EXPIRED)
    await waitFor(() => expect(result.current.total).toBe(6))

    // 期间店长在另一台电脑上为王建国续卡，订单不再是已到期
    const wang = result.current.items.find((o) => o.memberName === '王建国')
    await manager.post(
      '/orders/renew',
      { orders: [{ id: wang.id, version: wang.version }], years: 1 },
      {
        headers: { 'Idempotency-Key': 'a7f3c9e1-2b4d-4e8a-9c61-0d5e7b2f8a43' },
      },
    )
    act(() => result.current.refresh())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.total).toBe(5))
  })
})

describe('竞态', () => {
  test('先搜“袁”（慢），再切到已到期（快）：最终只显示已到期', async () => {
    const calls = controlledRequests({ honorAbort: false })
    const { result, rerender } = render(BY_YUAN)
    rerender({ q: EXPIRED })

    await act(() => calls[1].resolve())
    await act(() => calls[0].resolve())

    expect(names(result.current)).toEqual(EXPIRED_NAMES)
    expect(result.current.loading).toBe(false)
  })

  test('切换条件时取消上一次请求', () => {
    const calls = controlledRequests()
    const { rerender } = render(BY_YUAN)
    rerender({ q: EXPIRED })
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].signal.aborted).toBe(false)
  })

  test('旧请求失败不覆盖新请求的成功结果', async () => {
    const calls = controlledRequests({ honorAbort: false })
    const { result, rerender } = render(BY_YUAN)
    rerender({ q: EXPIRED })

    await act(() => calls[1].resolve())
    await act(() => calls[0].reject(serverError()))

    expect(result.current.error).toBeNull()
    expect(names(result.current)).toEqual(EXPIRED_NAMES)
  })

  test('旧请求返回不会关闭新请求的 loading', async () => {
    const calls = controlledRequests({ honorAbort: false })
    const { result, rerender } = render(BY_YUAN)
    rerender({ q: EXPIRED })

    await act(() => calls[0].resolve())
    expect(result.current.loading).toBe(true)
    expect(names(result.current)).not.toContain('袁志远')

    await act(() => calls[1].resolve())
    expect(result.current.loading).toBe(false)
    expect(names(result.current)).toEqual(EXPIRED_NAMES)
  })

  test('翻页时保留上一页数据并显示 loading', async () => {
    const calls = controlledRequests()
    const { result, rerender } = render(DEFAULT_QUERY)
    await act(() => calls[0].resolve())
    const firstPage = names(result.current)
    expect(firstPage).toHaveLength(10)

    rerender({ q: { ...DEFAULT_QUERY, page: 2 } })
    expect(result.current.loading).toBe(true)
    expect(names(result.current)).toEqual(firstPage)
  })
})

describe('失败', () => {
  test('查询失败时清空列表并返回错误，不提示 toast', async () => {
    const calls = controlledRequests()
    const { result } = render(DEFAULT_QUERY)
    await act(() => calls[0].reject(serverError()))

    expect(result.current).toMatchObject({
      loading: false,
      items: [],
      total: 0,
    })
    expect(result.current.error).toMatchObject({
      kind: 'general',
      message: '服务异常，请稍后重试',
    })
    expect(calls[0].params).toMatchObject(DEFAULT_QUERY)
  })

  test('失败后重试成功，错误消失', async () => {
    const calls = controlledRequests()
    const { result } = render(EXPIRED)
    await act(() => calls[0].reject(serverError()))
    expect(result.current.error).not.toBeNull()

    act(() => result.current.refresh())
    expect(result.current.error).toBeNull()
    expect(calls[1].params).toMatchObject(EXPIRED) // 沿用已提交条件
    await act(() => calls[1].resolve())
    expect(names(result.current)).toEqual(EXPIRED_NAMES)
  })
})

describe('卸载与 StrictMode', () => {
  test('离开页面时取消请求，迟到的响应不再更新状态', async () => {
    const calls = controlledRequests({ honorAbort: false })
    const { result, unmount } = render(DEFAULT_QUERY)
    const before = result.current
    unmount()
    expect(calls[0].signal.aborted).toBe(true)

    await act(() => calls[0].resolve())
    expect(result.current).toBe(before)
  })

  test('StrictMode 下第一次请求被取消，最终结果正确', async () => {
    const calls = controlledRequests()
    const { result } = render(EXPIRED, { strict: true })
    const live = calls.filter((c) => !c.signal.aborted)
    expect(live).toHaveLength(1)

    await act(() => live[0].resolve())
    expect(result.current).toMatchObject({ loading: false, error: null })
    expect(names(result.current)).toEqual(EXPIRED_NAMES)
  })
})

// 退出与 401 处理：401 均由模拟服务真实返回（登录失效场景见 src/mock/faults.js），
// 慢请求用于让旧会话的响应在换人登录之后才到达。

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import axios from 'axios'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseApiError } from '../api/errors'
import { http } from '../api/http'
import { createMockAdapter } from '../mock/adapter'
import { resetMockDb } from '../mock/db'
import { setFaults } from '../mock/faults'
import { routes } from '../router/routes'
import { authOf, FRONT_DESK, MANAGER } from '../test/fixtures'
import { AUTH_STORAGE_KEY, useAuthStore } from './authStore'

const initial = useAuthStore.getState()
const auth = () => useAuthStore.getState()

/** 发出请求并返回解析后的错误（成功时为 null），不让失败中断测试 */
const settle = (promise) =>
  promise.then(
    () => null,
    (e) => parseApiError(e),
  )
const getLogs = () => settle(http.get('/operation-logs'))
/**
 * 发出一个尚未返回的慢查询（姓名含“袁”的查询被设为慢查询），等请求真正带着当前 token 发出后返回。
 * 返回 { result, returned }：returned() 表示响应是否已到达，用来确认后续步骤发生在响应之前
 */
async function slowQuery() {
  let done = false
  const result = settle(
    http.get('/orders', { params: { memberName: '袁' } }),
  ).finally(() => (done = true))
  // 请求拦截器异步注入 token，等一轮事件循环确保请求已发出
  await new Promise((r) => setTimeout(r, 0))
  return { result, returned: () => done }
}

let warning
beforeEach(() => {
  resetMockDb()
  localStorage.clear()
  useAuthStore.setState(initial, true)
  warning = vi.spyOn(message, 'warning')
})
afterEach(() => {
  vi.restoreAllMocks()
  message.destroy()
})

describe('401 处理', () => {
  test('当前会话在服务端失效：清除登录并提示一次', async () => {
    auth().setAuth(authOf(FRONT_DESK))
    setFaults({ unauthorized: 1 })
    expect(await getLogs()).toMatchObject({ kind: 'unauthorized' })
    expect(auth()).toMatchObject({ token: null, signedOut: true })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test('列表、导出预览、日志三个请求同时返回 401，只提示一次', async () => {
    auth().setAuth(authOf(FRONT_DESK))
    setFaults({ unauthorized: 3 })
    const errors = await Promise.all([
      settle(http.get('/orders')),
      settle(
        http.post('/orders/export-preview', {
          scope: 'filtered',
          filters: { tab: 'all' },
        }),
      ),
      getLogs(),
    ])
    expect(errors.map((e) => e.status)).toEqual([401, 401, 401])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(auth().token).toBeNull()
  })

  test('前台下班后店长登录，前台旧会话迟到的 401 不影响店长', async () => {
    auth().setAuth(authOf(FRONT_DESK))
    setFaults({ slowQuery: { keyword: '袁', ms: 600 } })
    const late = await slowQuery() // 带着前台的 token 发出，尚未返回

    const manager = authOf(MANAGER)
    act(() => auth().clearAuth())
    act(() => auth().setAuth(manager))
    expect(late.returned()).toBe(false)
    setFaults({ unauthorized: 1 }) // 前台的会话在服务端已失效

    expect(await late.result).toMatchObject({ status: 401 })
    expect(auth()).toMatchObject(manager)
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain(manager.token)
    expect(warning).not.toHaveBeenCalled()
  })

  test('未登录时的 401 不做处理', async () => {
    expect(await getLogs()).toMatchObject({ status: 401 })
    expect(warning).not.toHaveBeenCalled()
    expect(auth().signedOut).toBe(false)
  })
})

describe('页面流程', () => {
  function renderLoggedIn(url, session = authOf(FRONT_DESK)) {
    auth().setAuth(session)
    const router = createMemoryRouter(routes, { initialEntries: [url] })
    render(<RouterProvider router={router} />)
    return router
  }
  const locationOf = (router) =>
    router.state.location.pathname + router.state.location.search
  const listLoaded = () =>
    waitFor(
      () =>
        expect(
          document.querySelector('.ant-pagination-total-text'),
        ).not.toBeNull(),
      { timeout: 3000 },
    )

  test('真实 mock 返回 401 后卸载受保护页面并回到登录页', async () => {
    // 本地保存的 token 被截断，模拟服务无法识别，受保护接口返回 401
    const broken = authOf(FRONT_DESK)
    const router = renderLoggedIn('/orders/new', {
      ...broken,
      token: broken.token.slice(0, 18),
    })
    expect(screen.getByText('wangfang')).toBeInTheDocument()

    await act(() => getLogs())

    await waitFor(() => expect(locationOf(router)).toBe('/login'))
    expect(screen.queryByText('wangfang')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(warning).toHaveBeenCalledTimes(1)
  })

  // 弹窗随页面卸载的真实流程见 OrdersPage.test：“退出与重新登录”
  test('手动退出与 401 使用同一流程：清除认证、回到登录页、不提示失效', async () => {
    const router = renderLoggedIn('/orders')
    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))

    expect(locationOf(router)).toBe('/login')
    expect(auth().token).toBeNull()
    expect(warning).not.toHaveBeenCalled()
  })

  test('退出后点浏览器后退：不能回到订单页面', async () => {
    const router = renderLoggedIn('/orders?tab=expired')
    await listLoaded()
    await userEvent.click(screen.getByRole('menuitem', { name: /新建订单/ }))
    await waitFor(() => expect(locationOf(router)).toBe('/orders/new'))

    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))
    await waitFor(() => expect(locationOf(router)).toBe('/login'))

    await act(() => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.queryByRole('heading', { name: '订单列表' })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })

  test('前台的慢查询还没返回时退出、店长登录：前台会话迟到的 401 不会把店长踢出', async () => {
    const router = renderLoggedIn('/orders')
    await listLoaded()
    // 足够长，保证换人登录完成时前台的请求仍在途中
    setFaults({ slowQuery: { keyword: '袁', ms: 5000 } })
    const late = await slowQuery()

    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))
    await userEvent.click(screen.getByLabelText('账号'))
    await userEvent.paste(MANAGER.username)
    await userEvent.click(screen.getByLabelText('密码'))
    await userEvent.paste(MANAGER.password)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(locationOf(router)).toBe('/orders'))
    await listLoaded()
    expect(late.returned()).toBe(false)
    setFaults({ unauthorized: 1 }) // 前台的会话在服务端已失效

    expect(await late.result).toMatchObject({ status: 401 })
    expect(locationOf(router)).toBe('/orders')
    expect(auth().username).toBe('lijun')
    expect(warning).not.toHaveBeenCalled()

    // 店长之后的请求正常
    const managerClient = axios.create({
      baseURL: '/api',
      adapter: createMockAdapter({ delay: 0 }),
      headers: { Authorization: `Bearer ${auth().token}` },
    })
    expect((await managerClient.get('/orders')).data.total).toBe(36)
  })
})

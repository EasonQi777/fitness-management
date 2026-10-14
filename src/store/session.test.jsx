import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message, Modal } from 'antd'
import { AxiosError } from 'axios'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { routes } from '../router/routes'
import { AUTH_STORAGE_KEY, useAuthStore } from './authStore'

const initial = useAuthStore.getState()
const auth = () => useAuthStore.getState()

// 可手动决定何时返回 401 的 adapter，用于模拟并发与迟到响应。
// axios 在请求拦截器之后异步调用 adapter，fire 需等待 adapter 被调用
function unauthorized() {
  let reject401
  let markCalled
  const called = new Promise((resolve) => (markCalled = resolve))
  const adapter = (config) =>
    new Promise((_, reject) => {
      reject401 = () =>
        reject(
          new AxiosError('401', 'ERR_BAD_REQUEST', config, null, {
            status: 401,
            data: createErrorBody('UNAUTHORIZED', '登录已失效'),
          }),
        )
      markCalled()
    })
  return {
    adapter,
    sent: called,
    fire: async () => {
      await called
      reject401()
    },
  }
}

let warning
beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
  warning = vi.spyOn(message, 'warning')
})
afterEach(() => {
  vi.restoreAllMocks()
  message.destroy()
  Modal.destroyAll()
})

describe('401 处理', () => {
  test('携带当前 token 的 401 清除登录并提示', async () => {
    auth().setAuth({ token: 'mock.a', username: 'a' })
    const r = unauthorized()
    const p = http.get('/x', { adapter: r.adapter }).catch(() => {})
    await r.fire()
    await p
    expect(auth()).toMatchObject({ token: null, signedOut: true })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test('三个请求同时返回 401，只提示一次', async () => {
    auth().setAuth({ token: 'mock.a', username: 'a' })
    const rs = [unauthorized(), unauthorized(), unauthorized()]
    const ps = rs.map((r) =>
      http.get('/x', { adapter: r.adapter }).catch(() => {}),
    )
    await Promise.all(rs.map((r) => r.fire()))
    await Promise.all(ps)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(auth().token).toBeNull()
  })

  test('旧会话迟到的 401 不影响重新登录后的新会话', async () => {
    auth().setAuth({ token: 'mock.old', username: 'a' })
    const late = unauthorized()
    const p = http.get('/x', { adapter: late.adapter }).catch(() => {})
    await late.sent // 请求已带着旧 token 发出

    act(() => auth().clearAuth())
    act(() => auth().setAuth({ token: 'mock.new', username: 'b' }))
    await late.fire()
    await p

    expect(auth()).toMatchObject({ token: 'mock.new', username: 'b' })
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toContain('mock.new')
    expect(warning).not.toHaveBeenCalled()
  })

  test('未携带 token 的 401 不做处理', async () => {
    const r = unauthorized()
    const p = http.get('/x', { adapter: r.adapter }).catch(() => {})
    await r.fire()
    await p
    expect(warning).not.toHaveBeenCalled()
    expect(auth().signedOut).toBe(false)
  })
})

describe('页面流程', () => {
  function renderLoggedIn(url, token = 'mock.t') {
    auth().setAuth({ token, username: '张三' })
    const router = createMemoryRouter(routes, { initialEntries: [url] })
    render(<RouterProvider router={router} />)
    return () => router.state.location.pathname + router.state.location.search
  }

  test('真实 mock 返回 401 后卸载受保护页面并回到登录页', async () => {
    // 'mock.t' 不是合法的 mock token，受保护接口会返回 401
    const location = renderLoggedIn('/orders/new?a=1')
    expect(screen.getByText('张三')).toBeInTheDocument()

    await act(() => http.get('/operation-logs').catch(() => {}))

    await waitFor(() => expect(location()).toBe('/login'))
    expect(screen.queryByText('张三')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test('手动退出与 401 使用同一流程：关闭弹窗、清除认证、不提示失效', async () => {
    const location = renderLoggedIn('/orders')
    act(() => {
      Modal.confirm({ title: '确认撤单？' })
    })
    await waitFor(() =>
      expect(document.querySelector('.ant-modal-confirm')).not.toBeNull(),
    )

    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))

    expect(location()).toBe('/login')
    expect(auth().token).toBeNull()
    await waitFor(() =>
      // jsdom 不触发 transitionend，弹窗停在离场动画；浏览器中会被移除
      expect(document.querySelector('.ant-modal-confirm').className).toMatch(
        /ant-zoom-leave/,
      ),
    )
    expect(warning).not.toHaveBeenCalled()
  })

  test('退出后重新登录，旧会话的 401 不会把用户踢出', async () => {
    const location = renderLoggedIn('/orders', 'mock.old')
    const late = unauthorized()
    const p = http.get('/x', { adapter: late.adapter }).catch(() => {})

    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))
    await userEvent.type(screen.getByLabelText('账号'), 'b')
    await userEvent.type(screen.getByLabelText('密码'), 'x{Enter}')
    await waitFor(() => expect(location()).toBe('/orders'))

    await late.fire()
    await p
    expect(location()).toBe('/orders')
    expect(auth().username).toBe('b')
  })
})

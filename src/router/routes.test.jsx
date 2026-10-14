import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, test } from 'vitest'
import { routes } from './routes'
import { useAuthStore } from '../store/authStore'

const initial = useAuthStore.getState()

function renderAt(url, { loggedIn = false } = {}) {
  useAuthStore.setState({
    token: loggedIn ? 'mock.t' : null,
    username: loggedIn ? 'admin' : null,
    restored: true,
  })
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  const location = () =>
    router.state.location.pathname + router.state.location.search
  return { router, location }
}

const heading = (name) => screen.getByRole('heading', { name })

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
})

describe('未登录', () => {
  test.each([
    ['/orders', '/login?redirect=%2Forders'],
    ['/orders/new', '/login?redirect=%2Forders%2Fnew'],
    [
      '/orders?tab=expired&page=2',
      '/login?redirect=%2Forders%3Ftab%3Dexpired%26page%3D2',
    ],
  ])('访问 %s 跳转登录并保存地址', (url, expected) => {
    const { location } = renderAt(url)
    expect(location()).toBe(expected)
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.queryByText('订单列表')).not.toBeInTheDocument()
  })

  test('"/" 进入登录页且不带回跳参数', () => {
    expect(renderAt('/').location()).toBe('/login')
  })

  test('登录后回到原受保护页面并保留查询参数', () => {
    const { location } = renderAt('/orders/new?from=menu')
    act(() =>
      useAuthStore.getState().setAuth({ token: 'mock.t', username: 'a' }),
    )
    expect(location()).toBe('/orders/new?from=menu')
    expect(heading('新建订单')).toBeInTheDocument()
  })

  test('没有回跳地址时登录后进入订单列表', () => {
    const { location } = renderAt('/login')
    act(() =>
      useAuthStore.getState().setAuth({ token: 'mock.t', username: 'a' }),
    )
    expect(location()).toBe('/orders')
  })

  test.each(['https://evil.com', '//evil.com', '/login', '/unknown'])(
    '不安全的回跳地址 %s 登录后进入订单列表',
    (redirect) => {
      const { location } = renderAt(
        `/login?redirect=${encodeURIComponent(redirect)}`,
      )
      act(() =>
        useAuthStore.getState().setAuth({ token: 'mock.t', username: 'a' }),
      )
      expect(location()).toBe('/orders')
    },
  )

  test('恢复登录态前不渲染受保护内容也不跳转', () => {
    useAuthStore.setState({ restored: false })
    const router = createMemoryRouter(routes, { initialEntries: ['/orders'] })
    render(<RouterProvider router={router} />)
    expect(router.state.location.pathname).toBe('/orders')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})

describe('已登录', () => {
  test.each([
    ['/orders', '订单列表'],
    ['/orders/new', '新建订单'],
  ])('可以访问 %s', (url, name) => {
    expect(renderAt(url, { loggedIn: true }).location()).toBe(url)
    expect(heading(name)).toBeInTheDocument()
  })

  test('"/" 进入订单列表', () => {
    expect(renderAt('/', { loggedIn: true }).location()).toBe('/orders')
  })

  test('访问登录页跳转订单列表', () => {
    expect(renderAt('/login', { loggedIn: true }).location()).toBe('/orders')
  })

  test('访问带回跳参数的登录页直接回跳', () => {
    const { location } = renderAt('/login?redirect=%2Forders%2Fnew', {
      loggedIn: true,
    })
    expect(location()).toBe('/orders/new')
  })
})

describe('404', () => {
  test.each([false, true])('未知路径显示 404（已登录：%s）', (loggedIn) => {
    renderAt('/no-such-page', { loggedIn })
    expect(screen.getByText('页面不存在')).toBeInTheDocument()
  })

  test.each([
    [false, '/login'],
    [true, '/orders'],
  ])('返回入口有效（已登录：%s → %s）', async (loggedIn, target) => {
    const { location } = renderAt('/orders/123', { loggedIn })
    await userEvent.click(screen.getByRole('button', { name: '返回首页' }))
    expect(location()).toBe(target)
  })
})

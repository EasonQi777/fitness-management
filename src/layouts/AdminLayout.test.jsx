import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, test } from 'vitest'
import { routes } from '../router/routes'
import { AUTH_STORAGE_KEY, useAuthStore } from '../store/authStore'

const initial = useAuthStore.getState()

function renderAt(url) {
  useAuthStore.getState().setAuth({ token: 'mock.t', username: '张三' })
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return {
    location: () =>
      router.state.location.pathname + router.state.location.search,
  }
}

const menu = () => screen.getByRole('menu')
const breadcrumb = () =>
  document.querySelector('.ant-breadcrumb').textContent.replace(/\s/g, '')
const selectedMenu = () =>
  menu().querySelector('.ant-menu-item-selected').textContent

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
})

describe('后台布局', () => {
  test('顶部显示当前用户名与退出入口', () => {
    renderAt('/orders')
    expect(screen.getByText('张三')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /退出登录/ })).toBeInTheDocument()
  })

  test('左侧菜单包含订单列表和新建订单', () => {
    renderAt('/orders')
    const items = within(menu()).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['订单列表', '新建订单'])
  })

  test.each([
    ['/orders', '订单列表', '订单管理/订单列表'],
    ['/orders/new', '新建订单', '订单管理/新建订单'],
    ['/orders?tab=expired', '订单列表', '订单管理/订单列表'],
  ])('%s：菜单选中 %s，面包屑 %s', (url, selected, crumbs) => {
    renderAt(url)
    expect(selectedMenu()).toBe(selected)
    expect(breadcrumb()).toBe(crumbs)
  })

  test('点击菜单切换页面，选中项与面包屑随路由变化', async () => {
    const { location } = renderAt('/orders')
    await userEvent.click(within(menu()).getByText('新建订单'))
    expect(location()).toBe('/orders/new')
    expect(
      screen.getByRole('heading', { name: '新建订单' }),
    ).toBeInTheDocument()
    expect(selectedMenu()).toBe('新建订单')
    expect(breadcrumb()).toBe('订单管理/新建订单')

    await userEvent.click(within(menu()).getByText('订单列表'))
    expect(location()).toBe('/orders')
    expect(selectedMenu()).toBe('订单列表')
  })

  test('退出登录清除 token 并回到登录页（不带回跳地址）', async () => {
    const { location } = renderAt('/orders/new')
    await userEvent.click(screen.getByRole('button', { name: /退出登录/ }))
    expect(location()).toBe('/login')
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
    expect(useAuthStore.getState().token).toBeNull()
    expect(screen.queryByText('张三')).not.toBeInTheDocument()
  })

  test('404 页面不使用后台布局', () => {
    renderAt('/orders/123')
    expect(screen.getByText('页面不存在')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

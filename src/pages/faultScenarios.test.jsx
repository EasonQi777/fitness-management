// 页面在异常场景下的表现：通过 setFaults 打开模拟服务的异常场景，页面经真实请求层访问。

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import AppProviders from '../AppProviders'
import { http } from '../api/http'
import { resetMockDb } from '../mock/db'
import { setFaults } from '../mock/faults'
import { routes } from '../router/routes'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK } from '../test/fixtures'

const initial = useAuthStore.getState()

beforeEach(() => {
  resetMockDb()
  localStorage.clear()
  useAuthStore.setState(initial, true)
})
afterEach(() => {
  vi.restoreAllMocks()
  message.destroy()
})

function openOrders(url = '/orders') {
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

const rows = () => [...document.querySelectorAll('tr.ant-table-row')]
const totalText = () =>
  document.querySelector('.ant-pagination-total-text')?.textContent
const waitTotal = (text) =>
  waitFor(() => expect(totalText()).toBe(text), { timeout: 3000 })
const rowOf = (name) => rows().find((tr) => tr.textContent.includes(name))

test('查询失败：显示错误与重试，重试后恢复', async () => {
  setFaults({ queryFailures: 1 })
  openOrders()
  const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
  expect(alert).toHaveTextContent('订单加载失败')
  expect(alert).toHaveTextContent('服务异常，请稍后重试')
  expect(rows()).toHaveLength(0)

  await userEvent.click(within(alert).getByRole('button', { name: /重\s*试/ }))
  await waitTotal('共 36 条')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('续卡时服务异常：只提示一次，订单不变，弹窗与年限保留；再次确认成功', async () => {
  const toast = vi.spyOn(message, 'error')
  openOrders('/orders?tab=expired')
  await waitTotal('共 6 条')
  await userEvent.click(
    within(rowOf('王建国')).getByRole('button', { name: /续\s*卡/ }),
  )
  await userEvent.clear(screen.getByLabelText('续卡年限'))
  await userEvent.type(screen.getByLabelText('续卡年限'), '2')

  setFaults({ writeFailures: 1 })
  await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ content: '服务异常，请稍后重试' }),
  )
  expect(screen.getByLabelText('续卡年限')).toHaveValue('2')
  const [wang] = (
    await http.get('/orders', { params: { memberName: '王建国' } })
  ).data.items
  expect(wang).toMatchObject({ status: 'expired', cardYears: 5 })

  await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))
  await waitTotal('共 5 条')
  expect(toast).toHaveBeenCalledTimes(1)
})

test('登录失效：只提示一次并回到登录页', async () => {
  const warning = vi.spyOn(message, 'warning')
  setFaults({ unauthorized: 1 })
  const router = openOrders()
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'), {
    timeout: 3000,
  })
  expect(warning).toHaveBeenCalledTimes(1)
  expect(warning).toHaveBeenCalledWith(
    expect.objectContaining({ content: '登录已失效，请重新登录' }),
  )
  expect(useAuthStore.getState().token).toBeNull()
})

test('先搜“袁”（慢）马上改搜“王”（快）：最终只显示王建国', async () => {
  setFaults({ slowQuery: { keyword: '袁', ms: 800 } })
  const router = openOrders()
  await waitTotal('共 36 条')

  const name = screen.getByLabelText('会员姓名')
  const search = () =>
    userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))
  await userEvent.type(name, '袁')
  await search()
  await userEvent.clear(name)
  await userEvent.type(name, '王')
  await search()

  await waitTotal('共 1 条')
  // 等过慢查询本应返回的时间，结果仍是王建国
  await new Promise((r) => setTimeout(r, 1000))
  expect(totalText()).toBe('共 1 条')
  expect(rows().map((tr) => tr.textContent)).toEqual([
    expect.stringContaining('王建国'),
  ])
  expect(router.state.location.search).toBe('?memberName=%E7%8E%8B')
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { routes } from '../router/routes'
import { AUTH_STORAGE_KEY, useAuthStore } from '../store/authStore'
import { FRONT_DESK } from '../test/fixtures'

const initial = useAuthStore.getState()

function renderLogin(url = '/login') {
  useAuthStore.setState({ restored: true })
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  const username = screen.getByLabelText('账号')
  const password = screen.getByLabelText('密码')
  return {
    location: () =>
      router.state.location.pathname + router.state.location.search,
    username,
    password,
    submit: screen.getByRole('button', { name: /登\s*录/ }),
    /** 填写前台员工的账号密码 */
    fillIn: async () => {
      await userEvent.type(username, FRONT_DESK.username)
      await userEvent.type(password, FRONT_DESK.password)
    },
  }
}

const httpError = (status, body) =>
  new AxiosError('fail', 'ERR', {}, null, { status, data: body })

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
})
afterEach(() => vi.restoreAllMocks())

describe('表单验证', () => {
  test('未填写直接点登录不能提交', async () => {
    const post = vi.spyOn(http, 'post')
    const { submit } = renderLogin()
    await userEvent.click(submit)
    expect(await screen.findByText('请输入账号')).toBeInTheDocument()
    expect(screen.getByText('请输入密码')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  test('只输入空格视为未填写', async () => {
    const post = vi.spyOn(http, 'post')
    const { username, password, submit } = renderLogin()
    await userEvent.type(username, '   ')
    await userEvent.type(password, '   ')
    await userEvent.click(submit)
    expect(await screen.findByText('请输入账号')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  test('密码使用密码输入框', () => {
    expect(renderLogin().password).toHaveAttribute('type', 'password')
  })

  test('没有注册、找回密码等额外入口', () => {
    renderLogin()
    expect(screen.queryByText(/注册|忘记密码|找回密码/)).not.toBeInTheDocument()
  })
})

describe('提交', () => {
  test('登录成功保存认证信息并进入订单列表', async () => {
    const { fillIn, submit, location } = renderLogin()
    await fillIn()
    await userEvent.click(submit)

    await waitFor(() => expect(location()).toBe('/orders'))
    expect(useAuthStore.getState().username).toBe('wangfang')
    const stored = localStorage.getItem(AUTH_STORAGE_KEY)
    expect(stored).toContain('wangfang')
    expect(stored).not.toContain(FRONT_DESK.password)
  })

  test('登录后回到之前查看的已到期列表第 2 页', async () => {
    const { fillIn, password, location } = renderLogin(
      '/login?redirect=%2Forders%3Ftab%3Dexpired%26page%3D2',
    )
    await fillIn()
    await userEvent.type(password, '{Enter}')
    await waitFor(() => expect(location()).toBe('/orders?tab=expired&page=2'))
  })

  test('提交中显示 loading，重复点击和回车只发送一次请求', async () => {
    const post = vi.spyOn(http, 'post')
    const { fillIn, password, submit, location } = renderLogin()
    await fillIn()
    await userEvent.click(submit)
    expect(submit).toHaveClass('ant-btn-loading')
    await userEvent.click(submit)
    await userEvent.type(password, '{Enter}')

    await waitFor(() => expect(location()).toBe('/orders'))
    expect(post).toHaveBeenCalledTimes(1)
  })

  test('服务异常时显示原因并保留账号，可再次提交', async () => {
    vi.spyOn(http, 'post').mockRejectedValueOnce(
      httpError(500, createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试')),
    )
    const { fillIn, username, submit, location } = renderLogin()
    await fillIn()
    await userEvent.click(submit)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '服务异常，请稍后重试',
    )
    expect(username).toHaveValue('wangfang')
    expect(location()).toBe('/login')
    expect(useAuthStore.getState().token).toBeNull()

    await userEvent.click(submit) // 第二次走真实 mock
    await waitFor(() => expect(location()).toBe('/orders'))
  })

  test('接口字段错误显示到对应字段', async () => {
    vi.spyOn(http, 'post').mockRejectedValueOnce(
      httpError(
        400,
        createErrorBody('VALIDATION_ERROR', '账号或密码错误', {
          fieldErrors: { password: '密码错误，请重新输入' },
        }),
      ),
    )
    const { fillIn, username, submit } = renderLogin()
    await fillIn()
    await userEvent.click(submit)

    expect(await screen.findByText('密码错误，请重新输入')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(username).toHaveValue('wangfang')
  })

  test('门店网络断开时显示提示', async () => {
    vi.spyOn(http, 'post').mockRejectedValueOnce(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    )
    const { fillIn, submit } = renderLogin()
    await fillIn()
    await userEvent.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('网络异常')
  })
})

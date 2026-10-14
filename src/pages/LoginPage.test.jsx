import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError } from 'axios'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { routes } from '../router/routes'
import { AUTH_STORAGE_KEY, useAuthStore } from '../store/authStore'

const initial = useAuthStore.getState()

function renderLogin(url = '/login') {
  useAuthStore.setState({ restored: true })
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return {
    router,
    location: () =>
      router.state.location.pathname + router.state.location.search,
    username: screen.getByLabelText('账号'),
    password: screen.getByLabelText('密码'),
    submit: screen.getByRole('button', { name: /登\s*录/ }),
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
  test('空输入不能提交', async () => {
    const post = vi.spyOn(http, 'post')
    const { submit } = renderLogin()
    await userEvent.click(submit)
    expect(await screen.findByText('请输入账号')).toBeInTheDocument()
    expect(screen.getByText('请输入密码')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  test('仅空格视为空', async () => {
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
    const { username, password, submit, location } = renderLogin()
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'secret')
    await userEvent.click(submit)

    await waitFor(() => expect(location()).toBe('/orders'))
    expect(useAuthStore.getState().username).toBe('admin')
    const stored = localStorage.getItem(AUTH_STORAGE_KEY)
    expect(stored).toContain('admin')
    expect(stored).not.toContain('secret')
  })

  test('登录后回到回跳地址', async () => {
    const { username, password, location } = renderLogin(
      '/login?redirect=%2Forders%2Fnew%3Fa%3D1',
    )
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'x{Enter}')
    await waitFor(() => expect(location()).toBe('/orders/new?a=1'))
  })

  test('提交中显示 loading，重复点击和回车只发送一次请求', async () => {
    const post = vi.spyOn(http, 'post')
    const { username, password, submit, location } = renderLogin()
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'x')
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
    const { username, password, submit, location } = renderLogin()
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'x')
    await userEvent.click(submit)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '服务异常，请稍后重试',
    )
    expect(username).toHaveValue('admin')
    expect(location()).toBe('/login')
    expect(useAuthStore.getState().token).toBeNull()

    await userEvent.click(submit) // 第二次走真实 mock
    await waitFor(() => expect(location()).toBe('/orders'))
  })

  test('接口字段错误显示到对应字段', async () => {
    vi.spyOn(http, 'post').mockRejectedValueOnce(
      httpError(
        400,
        createErrorBody('VALIDATION_ERROR', '参数错误', {
          fieldErrors: { password: '密码不正确' },
        }),
      ),
    )
    const { username, password, submit } = renderLogin()
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'x')
    await userEvent.click(submit)

    expect(await screen.findByText('密码不正确')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(username).toHaveValue('admin')
  })

  test('网络错误显示提示', async () => {
    vi.spyOn(http, 'post').mockRejectedValueOnce(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    )
    const { username, password, submit } = renderLogin()
    await userEvent.type(username, 'admin')
    await userEvent.type(password, 'x')
    await userEvent.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('网络异常')
  })
})

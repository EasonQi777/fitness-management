import { waitFor } from '@testing-library/react'
import { message } from 'antd'
import { AxiosError, CanceledError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '../store/authStore'
import { createErrorBody } from './errors'
import { http } from './http'

const initial = useAuthStore.getState()

// 单次请求替换 adapter：保留实例拦截器，精确控制响应
const ok = (config) =>
  Promise.resolve({ data: {}, status: 200, headers: {}, config })
const failWith = (status, body) => (config) =>
  Promise.reject(
    new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, {
      status,
      data: body,
    }),
  )
const request = (adapter, extra) =>
  http.get('/test', { adapter, ...extra }).catch((e) => e)

let toast
beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
  toast = vi.spyOn(message, 'error')
})
afterEach(() => {
  vi.restoreAllMocks()
  message.destroy()
})

describe('请求拦截器', () => {
  test('注入当前 token，切换登录后使用最新 token', async () => {
    let auth
    const capture = (config) => {
      auth = config.headers.Authorization
      return ok(config)
    }
    useAuthStore.getState().setAuth({ token: 'mock.a', username: 'a' })
    await http.get('/test', { adapter: capture })
    expect(auth).toBe('Bearer mock.a')

    useAuthStore.getState().setAuth({ token: 'mock.b', username: 'b' })
    await http.get('/test', { adapter: capture })
    expect(auth).toBe('Bearer mock.b')

    useAuthStore.getState().clearAuth()
    await http.get('/test', { adapter: capture })
    expect(auth).toBeUndefined()
  })

  test('baseURL 为 /api', () => {
    expect(http.defaults.baseURL).toBe('/api')
  })
})

describe('错误提示', () => {
  test('服务错误统一提示一次，错误仍传给调用方', async () => {
    const err = await request(
      failWith(500, createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试')),
    )
    expect(err).toBeInstanceOf(AxiosError)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0].content).toBe('服务异常，请稍后重试')
  })

  test('网络错误提示', async () => {
    await request((config) =>
      Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)),
    )
    expect(toast.mock.calls[0][0].content).toBe('网络异常，请稍后重试')
  })

  test.each([
    [
      '字段错误',
      failWith(
        400,
        createErrorBody('VALIDATION_ERROR', '参数错误', {
          fieldErrors: { phone: '手机号格式不正确' },
        }),
      ),
    ],
    [
      '批量业务错误',
      failWith(
        400,
        createErrorBody('INVALID_ORDERS', '有不合格订单', {
          invalidOrders: [{ id: '1', orderNo: 'NO1', reason: '状态不符' }],
        }),
      ),
    ],
    ['认证失效', failWith(401, createErrorBody('UNAUTHORIZED', '登录已失效'))],
    ['请求取消', () => Promise.reject(new CanceledError())],
  ])('%s 不由请求层提示', async (_, adapter) => {
    await request(adapter)
    expect(toast).not.toHaveBeenCalled()
  })

  test('skipErrorToast 时由页面自行展示', async () => {
    await request(failWith(500, createErrorBody('INTERNAL_ERROR', 'x')), {
      skipErrorToast: true,
    })
    expect(toast).not.toHaveBeenCalled()
  })

  test('AbortController 取消真实 mock 请求不提示', async () => {
    const controller = new AbortController()
    const p = http.post('/auth/login', {}, { signal: controller.signal })
    controller.abort()
    await p.catch(() => {})
    expect(toast).not.toHaveBeenCalled()
  })

  test('登录失败（字段错误）不提示，也不清除登录态', async () => {
    useAuthStore.getState().setAuth({ token: 'mock.t', username: 'u' })
    await http
      .post('/auth/login', { username: '', password: '' })
      .catch(() => {})
    expect(toast).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe('mock.t')
  })

  test('并发的相同错误只显示一条提示', async () => {
    toast.mockRestore()
    const adapter = failWith(500, createErrorBody('INTERNAL_ERROR', '服务异常'))
    await Promise.all([request(adapter), request(adapter), request(adapter)])
    await waitFor(() =>
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(1),
    )
    expect(document.querySelector('.ant-message').textContent).toContain(
      '服务异常',
    )
  })
})

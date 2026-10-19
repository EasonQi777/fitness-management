import { waitFor } from '@testing-library/react'
import { message } from 'antd'
import { AxiosError, CanceledError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK, MANAGER } from '../test/fixtures'
import { createErrorBody } from './errors'
import { http } from './http'

const initial = useAuthStore.getState()

// 单次请求替换 adapter：保留实例拦截器，精确控制响应
const ok = (config) =>
  Promise.resolve({ data: { items: [] }, status: 200, headers: {}, config })
const failWith = (status, body) => (config) =>
  Promise.reject(
    new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, {
      status,
      data: body,
    }),
  )
const request = (adapter, extra) =>
  http.get('/operation-logs', { adapter, ...extra }).catch((e) => e)

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
  test('交接班换人登录后，请求使用新员工的 token', async () => {
    let sent
    const capture = (config) => {
      sent = config.headers.Authorization
      return ok(config)
    }
    const frontDesk = authOf(FRONT_DESK)
    useAuthStore.getState().setAuth(frontDesk)
    await http.get('/operation-logs', { adapter: capture })
    expect(sent).toBe(`Bearer ${frontDesk.token}`)

    useAuthStore.getState().clearAuth()
    await http.get('/operation-logs', { adapter: capture })
    expect(sent).toBeUndefined()

    const manager = authOf(MANAGER)
    useAuthStore.getState().setAuth(manager)
    await http.get('/operation-logs', { adapter: capture })
    expect(sent).toBe(`Bearer ${manager.token}`)
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
      '新建订单手机号有误（字段错误）',
      failWith(
        400,
        createErrorBody('VALIDATION_ERROR', '订单信息填写有误', {
          fieldErrors: { phone: '请输入正确的 11 位手机号' },
        }),
      ),
    ],
    [
      '批量续卡中混入已取消订单（批量错误）',
      failWith(
        400,
        createErrorBody('INVALID_ORDERS', '所选订单中有 1 笔不可续卡', {
          invalidOrders: [
            {
              id: 'o-016',
              orderNo: 'FM20260719001',
              reason: '订单状态为「已取消」，仅已到期订单可续卡',
            },
          ],
        }),
      ),
    ],
    [
      '登录失效',
      failWith(401, createErrorBody('UNAUTHORIZED', '登录已失效，请重新登录')),
    ],
    ['请求取消', () => Promise.reject(new CanceledError())],
  ])('%s：不由请求层提示', async (_, adapter) => {
    await request(adapter)
    expect(toast).not.toHaveBeenCalled()
  })

  test('skipErrorToast 时由页面自行展示', async () => {
    await request(
      failWith(500, createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试')),
      { skipErrorToast: true },
    )
    expect(toast).not.toHaveBeenCalled()
  })

  test('AbortController 取消真实 mock 请求不提示', async () => {
    const controller = new AbortController()
    const p = http.post('/auth/login', FRONT_DESK, {
      signal: controller.signal,
    })
    controller.abort()
    await p.catch(() => {})
    expect(toast).not.toHaveBeenCalled()
  })

  test('另一个标签页登录时未填写账号，不提示也不清除当前登录', async () => {
    const manager = authOf(MANAGER)
    useAuthStore.getState().setAuth(manager)
    await http
      .post('/auth/login', { username: '', password: '' })
      .catch(() => {})
    expect(toast).not.toHaveBeenCalled()
    expect(useAuthStore.getState().token).toBe(manager.token)
  })

  test('并发的相同错误只显示一条提示', async () => {
    toast.mockRestore()
    const adapter = failWith(
      500,
      createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试'),
    )
    await Promise.all([request(adapter), request(adapter), request(adapter)])
    // 提示由 antd 异步渲染，全量并行运行时可能超过默认的 1 秒
    await waitFor(
      () =>
        expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(
          1,
        ),
      { timeout: 3000 },
    )
    expect(document.querySelector('.ant-message').textContent).toContain(
      '服务异常',
    )
  })
})

import axios from 'axios'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseApiError } from '../api/errors'
import { FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import { createMockAdapter } from './adapter'
import { verifyToken } from './server'

// 通过真实 axios 实例走完 adapter → 模拟服务的完整链路
const client = (delay = 0) =>
  axios.create({ baseURL: '/api', adapter: createMockAdapter({ delay }) })

const login = (body) => client().post('/auth/login', body)
const fail = (promise) =>
  promise.then(
    () => expect.fail('应当失败'),
    (e) => e,
  )

afterEach(() => vi.useRealTimers())

describe('登录', () => {
  test('任意非空账号密码登录成功', async () => {
    const { status, data } = await login(FRONT_DESK)
    expect(status).toBe(200)
    expect(data.username).toBe('wangfang')
    expect(verifyToken(data.token)).toBe('wangfang')
  })

  test('账号去除首尾空格（从通讯录复制时带入），支持中文账号', async () => {
    const { data } = await login({ username: ' 王芳 ', password: 'Wf@gym2026' })
    expect(data.username).toBe('王芳')
    expect(verifyToken(data.token)).toBe('王芳')
  })

  test('token 不包含明文密码', async () => {
    const { data } = await login(MANAGER)
    expect(data.token).not.toContain(MANAGER.password)
    expect(atob(data.token.slice('mock.'.length))).not.toContain(
      MANAGER.password,
    )
  })

  test.each([
    ['都未填写', { username: '', password: '' }, ['username', 'password']],
    [
      '账号只输入了空格',
      { username: '  ', password: 'Wf@gym2026' },
      ['username'],
    ],
    [
      '密码只输入了空格',
      { username: 'wangfang', password: '   ' },
      ['password'],
    ],
    ['请求体缺失', undefined, ['username', 'password']],
  ])('%s：返回字段错误', async (_, body, fields) => {
    const e = parseApiError(await fail(login(body)))
    expect(e.kind).toBe('field')
    expect(e.status).toBe(400)
    expect(Object.keys(e.fieldErrors)).toEqual(fields)
  })
})

describe('受保护接口', () => {
  const get = (headers) => client().get('/operation-logs', { headers })

  test('有效 token 可访问', async () => {
    const { data } = await login(FRONT_DESK)
    const res = await get({ Authorization: `Bearer ${data.token}` })
    expect(res.data).toEqual({ items: [] })
  })

  test.each([
    ['未携带 token', {}],
    ['漏写 Bearer 前缀', { Authorization: tokenFor(FRONT_DESK) }],
    [
      '其他系统签发的 JWT',
      {
        Authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDAyMyJ9.Qm9ndXNTaWduYXR1cmU',
      },
    ],
    [
      '复制时被截断的 token',
      { Authorization: `Bearer ${tokenFor(FRONT_DESK).slice(0, 18)}` },
    ],
    [
      '旧版本缺少用户名的 token',
      { Authorization: `Bearer mock.${btoa('{"iat":1791978135307}')}` },
    ],
  ])('%s：返回 401', async (_, headers) => {
    const e = parseApiError(await fail(get(headers)))
    expect(e).toMatchObject({ kind: 'unauthorized', code: 'UNAUTHORIZED' })
  })

  test('新的 adapter 实例（模拟刷新页面）仍可校验旧 token', async () => {
    const { data } = await login(FRONT_DESK)
    const res = await client().get('/operation-logs', {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('adapter', () => {
  test('请求未实现的接口返回 404', async () => {
    const e = await fail(client().get('/members'))
    expect(e.response.status).toBe(404)
    expect(e.response.data.code).toBe('NOT_FOUND')
  })

  test('createMockAdapter 默认延迟为 300 毫秒', async () => {
    vi.useFakeTimers()
    let done = false
    axios
      .create({ baseURL: '/api', adapter: createMockAdapter() })
      .post('/auth/login', FRONT_DESK)
      .then(() => (done = true))
    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  test('延迟期间取消请求', async () => {
    const controller = new AbortController()
    const promise = client(1000).post('/auth/login', FRONT_DESK, {
      signal: controller.signal,
    })
    controller.abort()
    expect(parseApiError(await fail(promise)).kind).toBe('cancelled')
  })

  test('响应数据为副本，页面修改不影响下一次响应', async () => {
    const first = await login(FRONT_DESK)
    first.data.username = first.data.username.toUpperCase() // 页面展示时改写
    const second = await login(FRONT_DESK)
    expect(second.data.username).toBe('wangfang')
  })
})

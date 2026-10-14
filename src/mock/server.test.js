import axios from 'axios'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseApiError } from '../api/errors'
import { createMockAdapter } from './adapter'
import { createToken, verifyToken } from './server'

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
    const { status, data } = await login({ username: 'admin', password: 'x' })
    expect(status).toBe(200)
    expect(data.username).toBe('admin')
    expect(verifyToken(data.token)).toBe('admin')
  })

  test('账号去除首尾空格，支持中文', async () => {
    const { data } = await login({ username: ' 张三 ', password: '1' })
    expect(data.username).toBe('张三')
    expect(verifyToken(data.token)).toBe('张三')
  })

  test('token 不包含明文密码', async () => {
    const password = 'secret-pass-123'
    const { data } = await login({ username: 'admin', password })
    expect(data.token).not.toContain(password)
    expect(atob(data.token.slice('mock.'.length))).not.toContain(password)
  })

  test.each([
    [{ username: '', password: '' }, ['username', 'password']],
    [{ username: '  ', password: 'x' }, ['username']],
    [{ username: 'a', password: '   ' }, ['password']],
    [undefined, ['username', 'password']],
  ])('空值 %j 返回字段错误', async (body, fields) => {
    const e = parseApiError(await fail(login(body)))
    expect(e.kind).toBe('field')
    expect(e.status).toBe(400)
    expect(Object.keys(e.fieldErrors)).toEqual(fields)
  })
})

describe('受保护接口', () => {
  const get = (headers) => client().get('/operation-logs', { headers })

  test('有效 token 可访问', async () => {
    const { data } = await login({ username: 'admin', password: 'x' })
    const res = await get({ Authorization: `Bearer ${data.token}` })
    expect(res.data).toEqual({ items: [] })
  })

  test.each([
    ['缺少 token', {}],
    ['不是 Bearer', { Authorization: createToken('admin') }],
    ['前缀错误', { Authorization: 'Bearer abc.def' }],
    ['内容不是 base64', { Authorization: 'Bearer mock.%%%' }],
    ['缺少用户名', { Authorization: `Bearer mock.${btoa('{"iat":1}')}` }],
  ])('%s 返回 401', async (_, headers) => {
    const e = parseApiError(await fail(get(headers)))
    expect(e).toMatchObject({ kind: 'unauthorized', code: 'UNAUTHORIZED' })
  })

  test('新的 adapter 实例（模拟刷新页面）仍可校验旧 token', async () => {
    const { data } = await login({ username: 'admin', password: 'x' })
    const res = await client().get('/operation-logs', {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    expect(res.status).toBe(200)
  })
})

describe('adapter', () => {
  test('未知接口返回 404', async () => {
    const e = await fail(client().get('/nope'))
    expect(e.response.status).toBe(404)
    expect(e.response.data.code).toBe('NOT_FOUND')
  })

  test('createMockAdapter 默认延迟为 300 毫秒', async () => {
    vi.useFakeTimers()
    let done = false
    axios
      .create({ baseURL: '/api', adapter: createMockAdapter() })
      .post('/auth/login', { username: 'a', password: 'b' })
      .then(() => (done = true))
    await vi.advanceTimersByTimeAsync(299)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })

  test('延迟期间取消请求', async () => {
    const controller = new AbortController()
    const promise = client(1000).post(
      '/auth/login',
      { username: 'a', password: 'b' },
      { signal: controller.signal },
    )
    controller.abort()
    expect(parseApiError(await fail(promise)).kind).toBe('cancelled')
  })

  test('响应数据为副本，修改不影响下一次响应', async () => {
    const a = await login({ username: 'admin', password: 'x' })
    a.data.username = 'hacked'
    const b = await login({ username: 'admin', password: 'x' })
    expect(b.data.username).toBe('admin')
  })
})

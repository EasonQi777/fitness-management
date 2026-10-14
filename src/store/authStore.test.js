import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AUTH_STORAGE_KEY, useAuthStore } from './authStore'

const initial = useAuthStore.getState()
const state = () => useAuthStore.getState()
const stored = () => localStorage.getItem(AUTH_STORAGE_KEY)

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
})
afterEach(() => vi.restoreAllMocks())

describe('登录与退出', () => {
  test('setAuth 只保存 token 和用户名，不保存密码', () => {
    state().setAuth({ token: 'mock.abc', username: 'admin', password: 'pw' })
    expect(JSON.parse(stored())).toEqual({
      token: 'mock.abc',
      username: 'admin',
    })
    expect(stored()).not.toContain('pw')
    expect(state()).toMatchObject({ token: 'mock.abc', username: 'admin' })
  })

  test('使用带项目标识的唯一键', () => {
    state().setAuth({ token: 't', username: 'u' })
    expect(Object.keys(localStorage)).toEqual(['fitness-management:auth'])
  })

  test.each([{ token: '', username: 'u' }, { token: 't', username: '  ' }, {}])(
    'setAuth 拒绝不完整数据 %j',
    (auth) => {
      expect(() => state().setAuth(auth)).toThrow()
      expect(stored()).toBeNull()
    },
  )

  test('clearAuth 清除 localStorage 与状态', () => {
    state().setAuth({ token: 't', username: 'u' })
    state().clearAuth()
    expect(stored()).toBeNull()
    expect(state()).toMatchObject({ token: null, username: null })
  })
})

describe('恢复登录态', () => {
  test('restore 前 restored 为 false', () => {
    expect(state().restored).toBe(false)
  })

  test('刷新后恢复用户名与登录态', () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ token: 'mock.abc', username: '张三' }),
    )
    state().restore()
    expect(state()).toMatchObject({
      token: 'mock.abc',
      username: '张三',
      restored: true,
    })
  })

  test('没有保存数据时为未登录', () => {
    state().restore()
    expect(state()).toMatchObject({ token: null, restored: true })
  })

  test.each([
    ['非 JSON', '{broken'],
    ['null', 'null'],
    ['数组', '[]'],
    ['缺少 token', '{"username":"u"}'],
    ['用户名不是字符串', '{"token":"t","username":1}'],
    ['空 token', '{"token":"","username":"u"}'],
  ])('损坏数据（%s）被清除并回到未登录', (_, raw) => {
    localStorage.setItem(AUTH_STORAGE_KEY, raw)
    state().restore()
    expect(state()).toMatchObject({
      token: null,
      username: null,
      restored: true,
    })
    expect(stored()).toBeNull()
  })

  test('恢复时丢弃多余字段', () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ token: 't', username: 'u', password: 'pw' }),
    )
    state().restore()
    expect(state()).not.toHaveProperty('password')
  })

  test('localStorage 不可用时按未登录处理且不抛异常', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => state().restore()).not.toThrow()
    expect(state()).toMatchObject({ token: null, restored: true })
  })

  test('无法写入 localStorage 时仍可在内存中登录', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    state().setAuth({ token: 't', username: 'u' })
    expect(state()).toMatchObject({ token: 't', username: 'u' })
  })
})

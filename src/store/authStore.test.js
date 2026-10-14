import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { authOf, FRONT_DESK, MANAGER } from '../test/fixtures'
import { AUTH_STORAGE_KEY, useAuthStore } from './authStore'

const initial = useAuthStore.getState()
const state = () => useAuthStore.getState()
const stored = () => localStorage.getItem(AUTH_STORAGE_KEY)

const frontDesk = authOf(FRONT_DESK)
const manager = authOf(MANAGER)

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(initial, true)
})
afterEach(() => vi.restoreAllMocks())

describe('登录与退出', () => {
  test('setAuth 只保存 token 和用户名，不保存密码', () => {
    // 登录表单的值被整体传入时，密码也不能落盘
    state().setAuth({ ...frontDesk, password: FRONT_DESK.password })
    expect(JSON.parse(stored())).toEqual(frontDesk)
    expect(stored()).not.toContain(FRONT_DESK.password)
    expect(state()).toMatchObject(frontDesk)
  })

  test('使用带项目标识的唯一键', () => {
    state().setAuth(frontDesk)
    expect(Object.keys(localStorage)).toEqual(['fitness-management:auth'])
  })

  test.each([
    ['登录接口未返回 token', { token: '', username: 'wangfang' }],
    ['用户名为空白', { token: frontDesk.token, username: '  ' }],
    ['登录响应为空', {}],
  ])('setAuth 拒绝不完整数据：%s', (_, auth) => {
    expect(() => state().setAuth(auth)).toThrow()
    expect(stored()).toBeNull()
  })

  test('clearAuth 清除 localStorage 与状态', () => {
    state().setAuth(frontDesk)
    state().clearAuth()
    expect(stored()).toBeNull()
    expect(state()).toMatchObject({ token: null, username: null })
  })

  test('signedOut：交接班退出后为 true，下一位员工登录或刷新恢复后为 false', () => {
    expect(state().signedOut).toBe(false)
    state().setAuth(frontDesk)
    state().clearAuth()
    expect(state().signedOut).toBe(true)
    state().setAuth(manager)
    expect(state().signedOut).toBe(false)
    state().clearAuth()
    state().restore()
    expect(state().signedOut).toBe(false)
  })
})

describe('恢复登录态', () => {
  test('restore 前 restored 为 false', () => {
    expect(state().restored).toBe(false)
  })

  test('刷新后恢复用户名与登录态', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(frontDesk))
    state().restore()
    expect(state()).toMatchObject({ ...frontDesk, restored: true })
  })

  test('没有保存数据时为未登录', () => {
    state().restore()
    expect(state()).toMatchObject({ token: null, restored: true })
  })

  test.each([
    ['写入时被中断，JSON 不完整', '{"token":"mock.eyJzdWIiOiJ3YW5nZmFuZyIs'],
    ['写入了 null', 'null'],
    [
      '旧版本的存储格式',
      '{"accessToken":"mock.eyJzdWIiOiJ3YW5nZmFuZyJ9","user":{"name":"wangfang"}}',
    ],
    [
      '用户名存成了员工编号数字',
      `{"token":"${frontDesk.token}","username":10023}`,
    ],
    ['token 为空字符串', '{"token":"","username":"wangfang"}'],
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

  test('恢复时丢弃多余字段（如旧版本误存的密码）', () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...frontDesk, password: FRONT_DESK.password }),
    )
    state().restore()
    expect(state()).not.toHaveProperty('password')
  })

  test('浏览器禁止访问 localStorage 时按未登录处理且不抛异常', () => {
    const denied = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied)
    expect(() => state().restore()).not.toThrow()
    expect(state()).toMatchObject({ token: null, restored: true })
  })

  test('存储空间已满时仍可在内存中登录', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException(
        "Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota.",
        'QuotaExceededError',
      )
    })
    state().setAuth(frontDesk)
    expect(state()).toMatchObject(frontDesk)
  })
})

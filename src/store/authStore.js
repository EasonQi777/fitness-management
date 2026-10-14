// 认证状态：唯一读写 localStorage 认证信息的位置，页面通过 useAuthStore 获取。

import { create } from 'zustand'

export const AUTH_STORAGE_KEY = 'fitness-management:auth'

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== ''

// localStorage 在隐私模式等情况下可能抛异常，失败时按未登录处理
function readStorage() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw === null) return null
    const data = JSON.parse(raw)
    if (isNonEmptyString(data?.token) && isNonEmptyString(data?.username))
      return { token: data.token, username: data.username }
  } catch {
    // 继续执行清理
  }
  removeStorage() // 损坏或结构不符的数据
  return null
}

function writeStorage(auth) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
  } catch {
    // 无法持久化时仅保留内存中的登录态
  }
}

function removeStorage() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // 忽略
  }
}

/**
 * token / username：当前登录信息，未登录为 null
 * restored：是否已从 localStorage 恢复，恢复前路由守卫不应做跳转判断
 * signedOut：本次会话是否已退出（主动退出或 401），用于登录页不保存回跳地址
 */
export const useAuthStore = create((set) => ({
  token: null,
  username: null,
  restored: false,
  signedOut: false,

  /** 启动时调用一次：从 localStorage 恢复登录态，损坏数据会被清除 */
  restore() {
    const auth = readStorage()
    set({
      token: auth?.token ?? null,
      username: auth?.username ?? null,
      restored: true,
      signedOut: false,
    })
  },

  /** 登录成功后调用；只保存 token 与用户名 */
  setAuth({ token, username }) {
    if (!isNonEmptyString(token) || !isNonEmptyString(username))
      throw new Error('setAuth 需要非空的 token 和 username')
    writeStorage({ token, username })
    set({ token, username, restored: true, signedOut: false })
  },

  clearAuth() {
    removeStorage()
    set({ token: null, username: null, restored: true, signedOut: true })
  },
}))

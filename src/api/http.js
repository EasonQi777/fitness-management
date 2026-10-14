import { message } from 'antd'
import axios from 'axios'
import { createMockAdapter } from '../mock/adapter'
import { useAuthStore } from '../store/authStore'
import { endSession } from '../store/session'
import { parseApiError } from './errors'

/**
 * 统一 axios 实例。错误提示约定：
 * - general（网络 / 服务 / 普通请求错误）由此处统一 toast，页面不再重复提示；
 *   页面自行展示时，请求配置传 { skipErrorToast: true }
 * - field / batch 交给页面展示；cancelled 不提示
 * - unauthorized 交给 endSession 统一退出（每个会话只处理一次）
 */
export const http = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter(),
})

http.interceptors.request.use((config) => {
  // 每次请求读取最新 token，避免沿用旧会话
  const { token } = useAuthStore.getState()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(undefined, (error) => {
  const e = parseApiError(error)
  if (e.kind === 'unauthorized') {
    // 只有携带“当前 token”的请求才能结束会话：
    // 并发 401 中第一个清除登录后，其余不再匹配；旧会话迟到的 401 也不会清除新登录
    const sent = error.config?.headers?.Authorization
    const { token } = useAuthStore.getState()
    if (token && sent === `Bearer ${token}`) endSession({ expired: true })
  } else if (e.kind === 'general' && !error.config?.skipErrorToast) {
    // 相同文案共用 key：并发的同类失败只显示一条
    message.error({ content: e.message, key: `api-error:${e.message}` })
  }
  return Promise.reject(error)
})

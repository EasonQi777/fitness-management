// 退出登录与 401 失效共用的清理流程。

import { message } from 'antd'
import { useAuthStore } from './authStore'

/**
 * 结束当前会话：清除认证；RequireAuth 随即跳转 /login，受保护页面卸载，
 * 页面内的选择、表单、弹窗状态随之释放，useOrders 在卸载时取消查询。
 * 业务弹窗都是页面内组件（不使用 Modal.confirm 等静态弹窗），会随页面一起卸载。
 * @param {{ expired?: boolean }} [options] expired 为 401 失效，额外提示一次
 */
export function endSession({ expired = false } = {}) {
  useAuthStore.getState().clearAuth()
  if (expired)
    message.warning({
      content: '登录已失效，请重新登录',
      key: 'session-expired',
    })
}

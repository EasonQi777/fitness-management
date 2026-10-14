// 退出登录与 401 失效共用的清理流程。

import { message, Modal } from 'antd'
import { useAuthStore } from './authStore'

/**
 * 结束当前会话：
 * 1. 关闭静态弹窗（Modal.confirm 等不在组件树内，不会随页面卸载）
 * 2. 清除认证；RequireAuth 随即跳转 /login，受保护页面卸载，
 *    页面内的选择、表单、弹窗状态随之释放，useOrders 在卸载时取消查询
 * @param {{ expired?: boolean }} [options] expired 为 401 失效，额外提示一次
 */
export function endSession({ expired = false } = {}) {
  Modal.destroyAll()
  useAuthStore.getState().clearAuth()
  if (expired)
    message.warning({
      content: '登录已失效，请重新登录',
      key: 'session-expired',
    })
}

import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'
import { useUnsavedStore } from '../store/unsavedStore'

/**
 * 表单有未保存内容时阻止离开：
 * - 站内导航（菜单、按钮、浏览器后退）返回 blocker，页面据此弹窗确认
 * - 刷新或关闭页面使用浏览器原生提示
 * - 会话结束（退出登录或 401）不会被拦截：清除认证后 RequireAuth 立即卸载本页面，
 *   拦截随之解除，再执行跳转到登录页
 * - 调用 allowLeave() 后放行（如提交成功）
 * @param {boolean} dirty 表单是否相对初始值有变化
 */
export function useLeaveGuard(dirty) {
  const allowedRef = useRef(false)

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowedRef.current &&
      currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    useUnsavedStore.setState({ dirty })
    if (!dirty) return
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = '' // 旧版浏览器需要设置 returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // 离开页面时清除标记
  useEffect(() => () => useUnsavedStore.setState({ dirty: false }), [])

  return {
    blocker,
    allowLeave: () => {
      allowedRef.current = true
      useUnsavedStore.setState({ dirty: false })
    },
  }
}

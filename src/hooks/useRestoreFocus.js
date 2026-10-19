import { useEffect, useState } from 'react'

/**
 * 弹窗由父组件按需挂载、关闭即卸载，antd 无法在关闭后把焦点还给打开它的按钮，
 * 键盘用户会回到页面开头。首次渲染时记下当前焦点（触发按钮），卸载后还原。
 * 只在焦点已丢失（回到 body）时还原：React StrictMode 开发环境的模拟卸载不会抢走弹窗内的焦点；
 * 触发按钮已不在页面中（如续卡后该行移出当前列表）时不处理。
 */
export function useRestoreFocus() {
  const [trigger] = useState(() => document.activeElement)
  useEffect(
    () => () => {
      setTimeout(() => {
        const lost =
          !document.activeElement || document.activeElement === document.body
        if (lost && trigger?.isConnected) trigger.focus()
      })
    },
    [trigger],
  )
}

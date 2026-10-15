import { useCallback, useEffect, useState } from 'react'
import { parseApiError } from '../api/errors'
import { fetchOrders } from '../api/orders'

// 请求标识：查询条件 + 刷新次数。结果记录自己属于哪个请求
const requestKeyOf = (...parts) => JSON.stringify(parts)

/**
 * 按已提交的查询条件加载订单列表。
 * - 条件变化或调用 refresh 时重新查询，并取消上一次未完成的请求
 * - 只有当前请求能写入结果：已返回但尚未处理的旧响应、旧请求的失败都会被丢弃
 * - loading 由“结果是否属于当前请求”推导，旧请求结束不会关闭新请求的 loading
 * - 卸载时取消请求，之后不再更新状态
 * - 查询失败时清空列表，避免把旧结果当作当前条件的结果展示
 * @param {ReturnType<typeof import('../domain/orderQuery').normalizeQuery>} query
 */
export function useOrders(query) {
  const { tab, orderNo, memberName, page, pageSize } = query
  const [refreshCount, setRefreshCount] = useState(0)
  const [result, setResult] = useState({
    key: null,
    items: [],
    total: 0,
    error: null,
  })
  const key = requestKeyOf(
    tab,
    orderNo,
    memberName,
    page,
    pageSize,
    refreshCount,
  )

  useEffect(() => {
    const requestKey = requestKeyOf(
      tab,
      orderNo,
      memberName,
      page,
      pageSize,
      refreshCount,
    )
    let current = true
    const controller = new AbortController()

    fetchOrders(
      { tab, orderNo, memberName, page, pageSize },
      { signal: controller.signal },
    ).then(
      ({ items, total }) => {
        if (current) setResult({ key: requestKey, items, total, error: null })
      },
      (err) => {
        const error = parseApiError(err)
        if (!current || error.kind === 'cancelled') return
        setResult({ key: requestKey, items: [], total: 0, error })
      },
    )

    return () => {
      current = false
      controller.abort()
    }
  }, [tab, orderNo, memberName, page, pageSize, refreshCount])

  const refresh = useCallback(() => setRefreshCount((n) => n + 1), [])

  return {
    items: result.items,
    total: result.total,
    error: result.key === key ? result.error : null,
    loading: result.key !== key,
    refresh,
  }
}

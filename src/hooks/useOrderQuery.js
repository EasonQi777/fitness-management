import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { parseQuery, toSearchParams } from '../domain/orderQuery'

// 修改这些条件时回到第 1 页
const RESETS_PAGE = ['tab', 'orderNo', 'memberName', 'pageSize']

/**
 * 订单列表已提交的查询条件，保存在 URL 中（刷新、前进后退可恢复）。
 * 输入框草稿由页面自行保存，只有提交时才调用 setQuery。
 * @returns {[ReturnType<typeof parseQuery>, (patch: object) => boolean]}
 *   setQuery 返回条件是否发生变化
 */
export function useOrderQuery() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useMemo(() => parseQuery(searchParams), [searchParams])
  const canonical = toSearchParams(query).toString()

  // URL 含无效或多余参数时替换为规范写法；替换后 canonical 与 URL 一致，不会循环
  useEffect(() => {
    if (searchParams.toString() !== canonical)
      setSearchParams(canonical, { replace: true })
  }, [searchParams, canonical, setSearchParams])

  const setQuery = useCallback(
    (patch) => {
      const resetPage = RESETS_PAGE.some((k) => k in patch)
      const next = toSearchParams({
        ...query,
        ...(resetPage && { page: 1 }),
        ...patch,
      }).toString()
      if (next === canonical) return false
      setSearchParams(next) // 新增历史记录，支持浏览器后退
      return true
    },
    [query, canonical, setSearchParams],
  )

  return [query, setQuery]
}

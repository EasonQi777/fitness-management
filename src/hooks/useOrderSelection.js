import { useCallback, useMemo, useState } from 'react'

/** 批量操作所需的最小信息（不含手机号、备注） */
const snapshotOf = ({
  id,
  orderNo,
  memberName,
  status,
  cardYears,
  version,
}) => ({
  id,
  orderNo,
  memberName,
  status,
  cardYears,
  version,
})

/**
 * 勾选订单：跨页、跨状态 Tab、跨搜索保留，只在主动清空、批量操作成功或退出登录（页面卸载）时清除。
 * - 以订单 ID 保存，按勾选先后排列
 * - 当前页出现已选订单时，以最新数据覆盖快照（状态、版本等）
 * - 已选订单可能不在当前筛选结果中，页面需提供“查看已选”入口；批量操作仍由接口最终校验
 * @param {import('../domain/orderRules').Order[]} items 当前页数据
 */
export function useOrderSelection(items) {
  const [stored, setStored] = useState(() => new Map())

  const select = useCallback(
    (orders, checked) =>
      setStored((prev) => {
        const next = new Map(prev)
        for (const o of orders)
          if (checked) next.set(o.id, snapshotOf(o))
          else next.delete(o.id)
        return next
      }),
    [],
  )

  const clear = useCallback(() => setStored(new Map()), [])

  const selectedOrders = useMemo(() => {
    const latest = new Map(items.map((o) => [o.id, o]))
    return [...stored.values()].map((o) =>
      latest.has(o.id) ? snapshotOf(latest.get(o.id)) : o,
    )
  }, [stored, items])

  return {
    selectedOrders,
    selectedIds: useMemo(() => [...stored.keys()], [stored]),
    count: stored.size,
    select,
    clear,
  }
}

// 订单列表查询条件：URL 解析、归一化与序列化。页面与模拟服务共用分组与每页数量。

import { ORDER_TABS } from './orderStatus'

export const PAGE_SIZES = [10, 20, 50]

export const DEFAULT_QUERY = Object.freeze({
  tab: 'all',
  orderNo: '',
  memberName: '',
  page: 1,
  pageSize: PAGE_SIZES[0],
})

const TAB_KEYS = new Set(ORDER_TABS.map((t) => t.key))
const KEYS = Object.keys(DEFAULT_QUERY)

const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * 归一化查询条件：无效值回退为默认值，文本去首尾空格
 * @param {Partial<Record<keyof typeof DEFAULT_QUERY, unknown>>} raw
 */
export function normalizeQuery(raw) {
  const page = String(raw.page ?? '')
  const pageSize = Number(raw.pageSize)
  return {
    tab: TAB_KEYS.has(raw.tab) ? raw.tab : DEFAULT_QUERY.tab,
    orderNo: text(raw.orderNo),
    memberName: text(raw.memberName),
    page: /^\d+$/.test(page) && Number(page) >= 1 ? Number(page) : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_QUERY.pageSize,
  }
}

/** 从 URL 查询参数解析 */
export const parseQuery = (searchParams) =>
  normalizeQuery(Object.fromEntries(KEYS.map((k) => [k, searchParams.get(k)])))

/** 序列化为 URL 查询参数：省略默认值，键顺序固定，保证同一条件只有一种写法 */
export function toSearchParams(query) {
  const q = normalizeQuery(query)
  const params = new URLSearchParams()
  for (const key of KEYS)
    if (q[key] !== DEFAULT_QUERY[key]) params.set(key, String(q[key]))
  return params
}

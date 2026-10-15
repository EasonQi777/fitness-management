// 订单相关模拟接口。

import { PAGE_SIZES } from '../domain/orderQuery'
import { ORDER_TABS } from '../domain/orderStatus'
import { db } from './db'
import { MockHttpError } from './httpError'

const invalid = (message) => new MockHttpError('VALIDATION_ERROR', message)

// 查询参数：缺失或空白视为未传
const param = (query, name) => query.get(name)?.trim() || null

function parsePage(value) {
  if (value === null) return 1
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw invalid('页码必须是正整数')
  return Number(value)
}

function parsePageSize(value) {
  if (value === null) return PAGE_SIZES[0]
  const size = Number(value)
  if (!PAGE_SIZES.includes(size) || !/^\d+$/.test(value))
    throw invalid(`每页数量只能是 ${PAGE_SIZES.join('、')}`)
  return size
}

function parseTab(value) {
  const tab = ORDER_TABS.find((t) => t.key === (value ?? 'all'))
  if (!tab) throw invalid('未知的订单状态分组')
  return tab
}

/** 创建时间降序；时间相同时按 ID 升序，保证翻页稳定 */
const byNewest = (a, b) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

/**
 * GET /orders：筛选 → 排序 → 分页。所有条件为 AND 关系。
 * 页码超出范围时返回空列表与真实总数，由页面回到最后有效页。
 */
export function listOrders({ query }) {
  const tab = parseTab(param(query, 'tab'))
  const orderNo = param(query, 'orderNo')
  const memberName = param(query, 'memberName')?.toLowerCase() ?? null
  const page = parsePage(param(query, 'page'))
  const pageSize = parsePageSize(param(query, 'pageSize'))

  const matched = db.orders
    .filter(
      (o) =>
        (tab.statuses.length === 0 || tab.statuses.includes(o.status)) &&
        (orderNo === null || o.orderNo === orderNo) &&
        (memberName === null ||
          o.memberName.toLowerCase().includes(memberName)),
    )
    .sort(byNewest)

  const start = (page - 1) * pageSize
  return {
    items: matched.slice(start, start + pageSize),
    total: matched.length,
    page,
    pageSize,
  }
}

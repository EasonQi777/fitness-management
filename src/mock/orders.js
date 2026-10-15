// 订单相关模拟接口。

import { PAGE_SIZES } from '../domain/orderQuery'
import {
  calcNewPrice,
  calcRenewPrice,
  calcRenewTotal,
  validateOrderInput,
  validateYears,
} from '../domain/orderRules'
import { ORDER_STATUS, ORDER_TABS, canRenew } from '../domain/orderStatus'
import { db } from './db'
import { MockHttpError } from './httpError'
import { idempotent, resolveOrders, saveOrders } from './writes'
import { formatDateTime } from '../utils/format'

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

const pad3 = (n) => String(n).padStart(3, '0')

function nextId() {
  const max = Math.max(0, ...db.orders.map((o) => Number(o.id.slice(2)) || 0))
  return `o-${pad3(max + 1)}`
}

/** 订单号 = FM + 创建日期（上海时间）+ 当日序号 */
function nextOrderNo(createdAt) {
  const prefix = `FM${formatDateTime(createdAt).slice(0, 10).replaceAll('-', '')}`
  const seqs = db.orders
    .filter((o) => o.orderNo.startsWith(prefix))
    .map((o) => Number(o.orderNo.slice(prefix.length)))
  return prefix + pad3(Math.max(0, ...seqs) + 1)
}

/**
 * POST /orders：新建订单。
 * 只接受姓名、手机号、年限、备注；金额、状态、编号由服务端决定，不信任页面传入的值。
 */
export const createOrder = idempotent('POST /orders', ({ body }) => {
  const input = {
    memberName: body?.memberName,
    phone: body?.phone,
    cardYears: body?.cardYears,
    remark: body?.remark,
  }
  const fieldErrors = validateOrderInput(input)
  if (Object.keys(fieldErrors).length)
    throw new MockHttpError('VALIDATION_ERROR', '订单信息填写有误', {
      fieldErrors,
    })

  const createdAt = new Date().toISOString()
  const order = {
    id: nextId(),
    orderNo: nextOrderNo(createdAt),
    memberName: input.memberName.trim(),
    phone: input.phone,
    cardYears: input.cardYears,
    amount: calcNewPrice(input.cardYears),
    status: 'pending_review',
    createdAt,
    remark: input.remark?.trim() ?? '',
    version: 1,
  }
  db.orders = [...db.orders, order]
  return order
})

/**
 * POST /orders/renew：续卡（单条与批量共用）。
 * 仅已到期订单可续；累计年限增加、状态改为待审核、版本加 1；
 * 金额与创建时间保留原值，续卡费用只在响应中返回（T36 写入操作日志）。
 */
export const renewOrders = idempotent('POST /orders/renew', ({ body }) => {
  const years = body?.years
  const yearsError = validateYears(years)
  if (yearsError)
    throw new MockHttpError('VALIDATION_ERROR', yearsError, {
      fieldErrors: { years: yearsError },
    })

  const orders = resolveOrders(body.orders, {
    check: (o) =>
      canRenew(o.status)
        ? null
        : `订单状态为「${ORDER_STATUS[o.status]?.label ?? o.status}」，仅已到期订单可续卡`,
  })
  const updated = orders.map((o) => ({
    ...o,
    cardYears: o.cardYears + years,
    status: 'pending_review',
    version: o.version + 1,
  }))
  saveOrders(updated)
  return {
    orders: updated,
    unitPrice: calcRenewPrice(years),
    totalPrice: calcRenewTotal(years, updated.length),
  }
})

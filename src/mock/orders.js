// 订单相关模拟接口。

import { PAGE_SIZES } from '../domain/orderQuery'
import {
  calcNewPrice,
  calcRenewPrice,
  calcRenewTotal,
  validateOrderInput,
  validateYears,
} from '../domain/orderRules'
import {
  ORDER_STATUS,
  ORDER_TABS,
  canCancel,
  canExport,
  canRenew,
} from '../domain/orderStatus'
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
 * 按筛选条件匹配订单并排序（列表查询与导出预览共用）。所有条件为 AND 关系。
 * @param {{ tab: (typeof ORDER_TABS)[number], orderNo: string | null, memberName: string | null }} filters
 *   orderNo、memberName 已去首尾空格，null 表示不过滤
 */
function matchOrders({ tab, orderNo, memberName }) {
  const name = memberName?.toLowerCase() ?? null
  return db.orders
    .filter(
      (o) =>
        (tab.statuses.length === 0 || tab.statuses.includes(o.status)) &&
        (orderNo === null || o.orderNo === orderNo) &&
        (name === null || o.memberName.toLowerCase().includes(name)),
    )
    .sort(byNewest)
}

/**
 * GET /orders：筛选 → 排序 → 分页。
 * 页码超出范围时返回空列表与真实总数，由页面回到最后有效页。
 */
export function listOrders({ query }) {
  const matched = matchOrders({
    tab: parseTab(param(query, 'tab')),
    orderNo: param(query, 'orderNo'),
    memberName: param(query, 'memberName'),
  })
  const page = parsePage(param(query, 'page'))
  const pageSize = parsePageSize(param(query, 'pageSize'))

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
export const createOrder = idempotent('POST /orders', ({ body }, { user }) => {
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
  writeLogs('create', user, [order], [order])
  return order
})

const statusLabel = (o) => ORDER_STATUS[o.status]?.label ?? o.status

/**
 * 记录操作日志：每笔订单一条。在订单写入后同步调用，与写入同时生效；
 * 校验失败的请求走不到这里，幂等重放不会再次执行处理器，因此都不会产生日志。
 * @param {'create' | 'renew' | 'cancel'} action
 * @param {string} operator 操作员工账号
 * @param {import('../domain/orderRules').Order[]} before 修改前（新建时与 after 相同）
 * @param {import('../domain/orderRules').Order[]} after 修改后
 * @param {{ renewYears: number, renewFee: number }} [extra] 续卡年限与单笔续卡费用
 */
function writeLogs(action, operator, before, after, extra) {
  const operatedAt = new Date().toISOString()
  db.logs = [
    ...db.logs,
    ...after.map((o, i) => ({
      id: `log-${db.logs.length + i + 1}`,
      action,
      operator,
      operatedAt,
      orderId: o.id,
      orderNo: o.orderNo,
      fromStatus: action === 'create' ? null : before[i].status,
      toStatus: o.status,
      ...extra,
    })),
  ]
}

/** GET /operation-logs：操作日志（仅供验证与调试，不建设页面） */
export const listOperationLogs = () => ({ items: structuredClone(db.logs) })

/**
 * POST /orders/renew：续卡（单条与批量共用）。
 * 仅已到期订单可续；累计年限增加、状态改为待审核、版本加 1；
 * 金额与创建时间保留原值，续卡费用写入操作日志。
 */
export const renewOrders = idempotent(
  'POST /orders/renew',
  ({ body }, { user }) => {
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
          : `订单状态为「${statusLabel(o)}」，仅已到期订单可续卡`,
    })
    const updated = orders.map((o) => ({
      ...o,
      cardYears: o.cardYears + years,
      status: 'pending_review',
      version: o.version + 1,
    }))
    saveOrders(updated)
    const unitPrice = calcRenewPrice(years)
    writeLogs('renew', user, orders, updated, {
      renewYears: years,
      renewFee: unitPrice,
    })
    return {
      orders: updated,
      unitPrice,
      totalPrice: calcRenewTotal(years, updated.length),
    }
  },
)

/**
 * POST /orders/cancel：撤单（批量原子操作）。
 * 仅待制卡、待寄卡订单可撤；状态改为已取消、版本加 1；金额、年限与创建时间不变。
 */
export const cancelOrders = idempotent(
  'POST /orders/cancel',
  ({ body }, { user }) => {
    const orders = resolveOrders(body?.orders, {
      check: (o) =>
        canCancel(o.status)
          ? null
          : `订单状态为「${statusLabel(o)}」，仅待制卡、待寄卡订单可撤单`,
    })
    const updated = orders.map((o) => ({
      ...o,
      status: 'cancelled',
      version: o.version + 1,
    }))
    saveOrders(updated)
    writeLogs('cancel', user, orders, updated)
    return { orders: updated }
  },
)

// 导出只包含对账所需字段，不含手机号与备注
const exportRow = ({
  id,
  orderNo,
  memberName,
  cardYears,
  amount,
  status,
  createdAt,
}) => ({ id, orderNo, memberName, cardYears, amount, status, createdAt })

/** 导出筛选条件中的文本：缺失或空白视为不过滤，非字符串视为参数错误 */
function filterText(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw invalid(`${label}格式不正确`)
  return value.trim() || null
}

function selectedOrders(ids) {
  if (!Array.isArray(ids) || ids.length === 0)
    throw invalid('请至少勾选一笔订单')
  if (!ids.every((id) => typeof id === 'string' && id !== ''))
    throw invalid('订单 ID 格式不正确')
  const duplicated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  if (duplicated.length) throw invalid(`订单重复提交：${duplicated.join('、')}`)
  const byId = new Map(db.orders.map((o) => [o.id, o]))
  return ids.map((id) => byId.get(id) ?? { id, missing: true })
}

/**
 * POST /orders/export-preview：导出前预览，由服务端最终判断导出范围与资格。
 * - scope = 'filtered'：按已提交的筛选条件匹配全部订单，不受分页限制
 * - scope = 'selected'：按勾选的订单 ID（可跨页、跨状态）
 * 仅已完成、已到期订单可导出，其余列入 excluded 并说明原因；不存在的 ID 也列入 excluded。
 * items 与列表排序一致（创建时间降序），只含导出字段。只读，不需要幂等键。
 */
export function previewExport({ body }) {
  let candidates
  if (body?.scope === 'filtered') {
    const filters = body.filters ?? {}
    candidates = matchOrders({
      tab: parseTab(filterText(filters.tab, '状态分组')),
      orderNo: filterText(filters.orderNo, '订单号'),
      memberName: filterText(filters.memberName, '会员姓名'),
    })
  } else if (body?.scope === 'selected') {
    candidates = selectedOrders(body.ids)
  } else throw invalid('导出范围只能是 filtered 或 selected')

  const found = candidates.filter((o) => !o.missing).sort(byNewest)
  return {
    items: found.filter((o) => canExport(o.status)).map(exportRow),
    excluded: [
      ...found
        .filter((o) => !canExport(o.status))
        .map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          reason: `订单状态为「${statusLabel(o)}」，仅已完成、已到期订单可导出`,
        })),
      ...candidates
        .filter((o) => o.missing)
        .map((o) => ({ id: o.id, orderNo: null, reason: '订单不存在' })),
    ],
  }
}

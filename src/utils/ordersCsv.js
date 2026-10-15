// 订单导出 CSV：固定中文表头，UTF-8 BOM + CRLF，便于 Excel 直接打开中文不乱码。

import dayjs from 'dayjs'
import { ORDER_STATUS } from '../domain/orderStatus'
import { DISPLAY_TIMEZONE, formatAmount, formatDateTime } from './format'

const SCOPE_NAMES = { filtered: '筛选结果', selected: '勾选记录' }

/**
 * 导出文件名：订单导出_筛选结果_20261015-154208.csv（上海时间）
 * @param {'filtered' | 'selected'} scope
 * @param {Date} [now]
 */
export const ordersCsvFileName = (scope, now = new Date()) =>
  `订单导出_${SCOPE_NAMES[scope]}_${dayjs(now).tz(DISPLAY_TIMEZONE).format('YYYYMMDD-HHmmss')}.csv`

const HEADERS = [
  '订单号',
  '会员姓名',
  '购卡年限',
  '订单金额',
  '状态',
  '创建时间',
]
const BOM = '\uFEFF'
const CRLF = '\r\n'

// 表格软件会把以 = + - @ 或制表符等控制字符开头的单元格当作公式执行（CSV 注入）
const looksLikeFormula = (text) =>
  /^[=+\-@]/.test(text) || text.charCodeAt(0) < 0x20

/**
 * 单元格：防公式后整体加双引号，内部双引号加倍；逗号、换行因此不会拆分单元格。
 * 以公式字符开头的文本前加单引号，表格软件按文本显示而不执行。
 */
function cell(value) {
  const text = String(value)
  const safe = looksLikeFormula(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/** 金额：空金额为空单元格，其余为千分位两位小数（文本，见 README E6） */
const amountCell = (amount) => (amount === null ? '' : formatAmount(amount))

/**
 * 生成订单导出 CSV（不含手机号与备注）
 * @param {Pick<import('../domain/orderRules').Order, 'orderNo' | 'memberName' | 'cardYears' | 'amount' | 'status' | 'createdAt'>[]} items
 * @returns {string}
 */
export function buildOrdersCsv(items) {
  const rows = items.map((o) => [
    o.orderNo,
    o.memberName,
    o.cardYears,
    amountCell(o.amount),
    ORDER_STATUS[o.status]?.label ?? o.status,
    formatDateTime(o.createdAt),
  ])
  return (
    BOM +
    [HEADERS, ...rows].map((row) => row.map(cell).join(',') + CRLF).join('')
  )
}

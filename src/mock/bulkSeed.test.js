import dayjs from 'dayjs'
import { describe, expect, test } from 'vitest'
import {
  PRICE_PER_YEAR,
  validateMemberName,
  validatePhone,
} from '../domain/orderRules'
import { canCancel, canRenew } from '../domain/orderStatus'
import { formatDateTime } from '../utils/format'
import { createBulkTestOrders } from './bulkSeed'
import { createSeedOrders } from './seed'

const orders = createBulkTestOrders()
const asOf = dayjs(
  orders
    .map((o) => o.createdAt)
    .sort()
    .at(-1),
)

describe('批量操作测试数据集', () => {
  test('已到期与可撤单订单都超过一页（每页 10 条），并至少 12 笔', () => {
    const renewable = orders.filter((o) => canRenew(o.status))
    const cancellable = orders.filter((o) => canCancel(o.status))
    expect(renewable.length).toBeGreaterThanOrEqual(12)
    expect(cancellable.length).toBeGreaterThanOrEqual(12)
    expect(renewable.length).toBeGreaterThan(10)
    expect(cancellable.length).toBeGreaterThan(10)
  })

  test('包含其他状态，便于验证混合选择', () => {
    const statuses = new Set(orders.map((o) => o.status))
    expect(statuses).toEqual(
      new Set([
        'expired',
        'pending_card',
        'pending_shipping',
        'completed',
        'pending_review',
        'cancelled',
      ]),
    )
  })

  test('ID、订单号、姓名、手机号均唯一且格式合法', () => {
    for (const key of ['id', 'orderNo', 'memberName', 'phone'])
      expect(new Set(orders.map((o) => o[key])).size).toBe(orders.length)
    for (const o of orders) {
      expect(validateMemberName(o.memberName)).toBeNull()
      expect(validatePhone(o.phone)).toBeNull()
    }
  })

  test('订单号含创建日期，已到期订单卡期已结束，金额为年限标准价', () => {
    for (const o of orders) {
      const date = formatDateTime(o.createdAt).slice(0, 10).replaceAll('-', '')
      expect(o.orderNo.startsWith(`FM${date}`)).toBe(true)
      expect(o.amount).toBe(o.cardYears * PRICE_PER_YEAR)
    }
    for (const o of orders.filter((o) => o.status === 'expired'))
      expect(dayjs(o.createdAt).add(o.cardYears, 'year').isBefore(asOf)).toBe(
        true,
      )
  })

  test('每次生成完全相同', () => {
    expect(createBulkTestOrders()).toEqual(createBulkTestOrders())
  })

  test('不影响默认演示数据：仍为 36 笔、每种状态 6 笔', () => {
    const seed = createSeedOrders()
    expect(seed).toHaveLength(36)
    expect(seed.filter((o) => o.status === 'expired')).toHaveLength(6)
  })
})

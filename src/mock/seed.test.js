import dayjs from 'dayjs'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  PRICE_PER_YEAR,
  validateMemberName,
  validatePhone,
  validateRemark,
} from '../domain/orderRules'
import { ORDER_STATUS, canExport } from '../domain/orderStatus'
import { formatDateTime } from '../utils/format'
import { db, resetMockDb } from './db'
import { createSeedOrders } from './seed'

const orders = createSeedOrders()
// 数据截止时间：最新一笔订单的创建时间
const asOf = dayjs(
  orders
    .map((o) => o.createdAt)
    .sort()
    .at(-1),
)
const cardEnd = (o) => dayjs(o.createdAt).add(o.cardYears, 'year')

describe('初始订单', () => {
  test('共 36 条，6 种状态各 6 条', () => {
    expect(orders).toHaveLength(36)
    const counts = {}
    for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1
    expect(counts).toEqual(
      Object.fromEntries(Object.keys(ORDER_STATUS).map((s) => [s, 6])),
    )
  })

  test('ID 与订单号均唯一', () => {
    expect(new Set(orders.map((o) => o.id)).size).toBe(36)
    expect(new Set(orders.map((o) => o.orderNo)).size).toBe(36)
  })

  test.each(orders.map((o) => [o.orderNo, o]))(
    '%s 字段符合订单模型',
    (_, o) => {
      expect(Object.keys(o).sort()).toEqual(
        [
          'amount',
          'cardYears',
          'createdAt',
          'id',
          'memberName',
          'orderNo',
          'phone',
          'remark',
          'status',
          'version',
        ].sort(),
      )
      expect(validateMemberName(o.memberName)).toBeNull()
      expect(o.memberName).toBe(o.memberName.trim())
      expect(validatePhone(o.phone)).toBeNull()
      expect(Number.isInteger(o.cardYears) && o.cardYears >= 1).toBe(true)
      expect(
        o.amount === null || (Number.isInteger(o.amount) && o.amount >= 0),
      ).toBe(true)
      expect(ORDER_STATUS).toHaveProperty(o.status)
      expect(new Date(o.createdAt).toISOString()).toBe(o.createdAt)
      expect(typeof o.remark).toBe('string')
      expect(validateRemark(o.remark)).toBeNull()
      expect(Number.isInteger(o.version) && o.version >= 1).toBe(true)
    },
  )
})

describe('业务数据一致性', () => {
  test('订单号包含创建日期（上海时间）与当日序号', () => {
    for (const o of orders) {
      const date = formatDateTime(o.createdAt).slice(0, 10).replaceAll('-', '')
      expect(o.orderNo).toMatch(new RegExp(`^FM${date}\\d{3}$`))
    }
  })

  test('ID 随创建时间递增', () => {
    const byId = [...orders].sort((a, b) => a.id.localeCompare(b.id))
    const times = byId.map((o) => o.createdAt)
    expect(times).toEqual([...times].sort())
  })

  test('已到期订单的卡期已结束，已完成订单仍在卡期内', () => {
    for (const o of orders.filter((o) => o.status === 'expired'))
      expect(cardEnd(o).isBefore(asOf)).toBe(true)
    for (const o of orders.filter((o) => o.status === 'completed'))
      expect(cardEnd(o).isAfter(asOf)).toBe(true)
  })

  test('金额为首次购卡金额：不超过累计年限的标准价', () => {
    for (const o of orders.filter((o) => o.amount !== null)) {
      expect(o.amount % PRICE_PER_YEAR).toBe(0)
      expect(o.amount / PRICE_PER_YEAR).toBeLessThanOrEqual(o.cardYears)
    }
  })

  test('续卡过的订单（累计年限大于首次购卡年限）版本号大于 1', () => {
    for (const o of orders.filter(
      (o) => o.amount > 0 && o.cardYears > o.amount / PRICE_PER_YEAR,
    ))
      expect(o.version).toBeGreaterThan(1)
  })
})

describe('列表与导出需要覆盖的情况', () => {
  const exportable = orders.filter((o) => canExport(o.status))

  test('可导出订单中有零金额与空金额', () => {
    expect(exportable.some((o) => o.amount === 0)).toBe(true)
    expect(exportable.some((o) => o.amount === null)).toBe(true)
  })

  test('存在创建时间相同的订单', () => {
    const times = orders.map((o) => o.createdAt)
    expect(new Set(times).size).toBeLessThan(times.length)
  })

  test('已到期订单中有累计年限超过 10 的会员', () => {
    expect(orders.some((o) => o.status === 'expired' && o.cardYears > 10)).toBe(
      true,
    )
  })

  test('姓名包含复姓、带间隔号的少数民族姓名与外籍会员英文名', () => {
    const names = orders.map((o) => o.memberName)
    expect(names).toContain('欧阳晓峰')
    expect(names.some((n) => n.includes('·'))).toBe(true)
    expect(names.some((n) => /^[A-Za-z ]+$/.test(n))).toBe(true)
  })
})

describe('确定性与重置', () => {
  beforeEach(() => resetMockDb())

  test('每次生成的数据完全相同', () => {
    expect(createSeedOrders()).toEqual(createSeedOrders())
  })

  test('每次返回新的对象，修改不影响下一次', () => {
    const a = createSeedOrders()
    a[0].memberName = '已修改'
    expect(createSeedOrders()[0].memberName).not.toBe('已修改')
  })

  test('重置后恢复初始数据', () => {
    db.orders[0].status = 'cancelled'
    db.orders.push({ ...db.orders[0], id: 'o-999' })
    resetMockDb()
    expect(db.orders).toEqual(createSeedOrders())
  })

  test('可重置为指定数据集，且与传入数组相互独立', () => {
    const custom = createSeedOrders().slice(0, 2)
    resetMockDb(custom)
    custom[0].status = 'cancelled'
    expect(db.orders).toHaveLength(2)
    expect(db.orders[0].status).not.toBe('cancelled')
  })
})

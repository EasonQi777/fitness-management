import { describe, expect, test } from 'vitest'
import {
  ORDER_STATUS,
  ORDER_TABS,
  canCancel,
  canExport,
  canRenew,
} from './orderStatus'

describe('状态映射', () => {
  test('六种状态的中文名完整', () => {
    expect(
      Object.fromEntries(
        Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label]),
      ),
    ).toEqual({
      pending_review: '待审核',
      pending_card: '待制卡',
      pending_shipping: '待寄卡',
      completed: '已完成',
      expired: '已到期',
      cancelled: '已取消',
    })
  })

  test('每种状态都有颜色且互不相同', () => {
    const colors = Object.values(ORDER_STATUS).map((s) => s.color)
    expect(colors.every(Boolean)).toBe(true)
    expect(new Set(colors).size).toBe(6)
  })
})

describe('筛选分组', () => {
  test('五个 Tab 的顺序与名称', () => {
    expect(ORDER_TABS.map((t) => t.label)).toEqual([
      '全部',
      '进行中',
      '已到期',
      '已完成',
      '已取消',
    ])
  })

  test('“进行中”包含待审核、待制卡、待寄卡', () => {
    const tab = ORDER_TABS.find((t) => t.key === 'in_progress')
    expect(tab.statuses).toEqual([
      'pending_review',
      'pending_card',
      'pending_shipping',
    ])
  })

  test('Tab 只引用已定义的状态', () => {
    for (const tab of ORDER_TABS) {
      for (const s of tab.statuses) expect(ORDER_STATUS).toHaveProperty(s)
    }
  })
})

describe('操作资格', () => {
  // [状态, 可续卡, 可撤单, 可导出]
  test.each([
    ['pending_review', false, false, false],
    ['pending_card', false, true, false],
    ['pending_shipping', false, true, false],
    ['completed', false, false, true],
    ['expired', true, false, true],
    ['cancelled', false, false, false],
  ])('%s：续卡 %s，撤单 %s，导出 %s', (status, renew, cancel, exp) => {
    expect(canRenew(status)).toBe(renew)
    expect(canCancel(status)).toBe(cancel)
    expect(canExport(status)).toBe(exp)
  })

  test('表格覆盖了全部已定义状态', () => {
    expect(Object.keys(ORDER_STATUS)).toHaveLength(6)
  })

  test.each([undefined, null, '', 'EXPIRED', 'unknown', 'constructor'])(
    '未知状态 %j 不允许任何操作',
    (status) => {
      expect(canRenew(status)).toBe(false)
      expect(canCancel(status)).toBe(false)
      expect(canExport(status)).toBe(false)
    },
  )
})

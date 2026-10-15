import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { createSeedOrders } from '../mock/seed'
import { useOrderSelection } from './useOrderSelection'

const seed = createSeedOrders()
const byName = (name) => seed.find((o) => o.memberName === name)

const setup = (items) =>
  renderHook(({ items }) => useOrderSelection(items), {
    initialProps: { items },
  })

describe('useOrderSelection', () => {
  test('只保存批量操作所需字段，不保存手机号与备注', () => {
    const wang = byName('王建国')
    const { result } = setup([wang])
    act(() => result.current.select([wang], true))
    expect(result.current.selectedOrders).toEqual([
      {
        id: wang.id,
        orderNo: 'FM20190309001',
        memberName: '王建国',
        status: 'expired',
        cardYears: 5,
        version: 2,
      },
    ])
  })

  test('切换到其他状态的列表后，已选订单仍保留，按勾选先后排列', () => {
    const fan = byName('范思远')
    const wang = byName('王建国')
    const { result, rerender } = setup([fan])
    act(() => result.current.select([fan], true))

    rerender({ items: [wang] }) // 切到“已到期”，范思远不在当前页
    act(() => result.current.select([wang], true))
    expect(result.current.selectedOrders.map((o) => o.memberName)).toEqual([
      '范思远',
      '王建国',
    ])
  })

  test('同事为已勾选订单续卡后刷新列表，快照更新为最新状态与版本', () => {
    const wang = byName('王建国')
    const li = byName('李秀英')
    const { result, rerender } = setup([wang, li])
    act(() => result.current.select([wang, li], true))

    const renewed = {
      ...wang,
      status: 'pending_review',
      cardYears: 8,
      version: 3,
    }
    rerender({ items: [renewed] }) // 李秀英不在当前页
    expect(result.current.selectedOrders).toEqual([
      expect.objectContaining({
        id: wang.id,
        status: 'pending_review',
        version: 3,
      }),
      expect.objectContaining({ id: li.id, status: 'expired', version: 1 }),
    ])
  })

  test('清空后为空', () => {
    const wang = byName('王建国')
    const { result } = setup([wang])
    act(() => result.current.select([wang], true))
    act(() => result.current.clear())
    expect(result.current).toMatchObject({ count: 0, selectedIds: [] })
  })
})

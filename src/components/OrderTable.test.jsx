import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ORDER_STATUS } from '../domain/orderStatus'
import { createSeedOrders } from '../mock/seed'
import OrderTable from './OrderTable'

const seed = createSeedOrders()
const byName = (name) => seed.find((o) => o.memberName === name)

// 每种状态各取一笔真实订单
const ONE_PER_STATUS = Object.keys(ORDER_STATUS).map((status) =>
  seed.find((o) => o.status === status),
)

function renderTable(items, props) {
  render(<OrderTable items={items} pagination={false} {...props} />)
  const rowOf = (order) => screen.getByText(order.orderNo).closest('tr')
  return { rowOf }
}

describe('列与展示格式', () => {
  test('包含全部列', () => {
    renderTable([byName('孙浩')])
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual([
      '订单号',
      '会员姓名',
      '购卡年限',
      '订单金额（元）',
      '状态',
      '创建时间',
      '操作',
    ])
  })

  test('十年卡金额 12000 显示为 12,000.00', () => {
    const order = byName('孙浩')
    const { rowOf } = renderTable([order])
    expect(within(rowOf(order)).getByText('12,000.00')).toBeInTheDocument()
    expect(within(rowOf(order)).getByText('10 年')).toBeInTheDocument()
  })

  test('员工福利卡（0 元）与旧系统缺失金额不混淆', () => {
    const free = byName('陈志强')
    const missing = byName('刘婷')
    const { rowOf } = renderTable([free, missing])
    expect(within(rowOf(free)).getByText('0.00')).toBeInTheDocument()
    expect(within(rowOf(missing)).getByLabelText('金额缺失')).toHaveTextContent(
      '—',
    )
    expect(within(rowOf(missing)).queryByText('0.00')).not.toBeInTheDocument()
  })

  test('创建时间按上海时区显示到秒', () => {
    const order = byName('范思远') // 2026-10-14T08:40:09Z
    const { rowOf } = renderTable([order])
    expect(
      within(rowOf(order)).getByText('2026-10-14 16:40:09'),
    ).toBeInTheDocument()
  })

  test('累计年限超过 10 年正常显示', () => {
    const order = byName('欧阳晓峰')
    const { rowOf } = renderTable([order])
    expect(within(rowOf(order)).getByText('13 年')).toBeInTheDocument()
  })

  test('带间隔号的姓名与英文姓名原样显示', () => {
    renderTable([byName('阿依古丽·买买提'), byName('David Miller')])
    expect(screen.getByText('阿依古丽·买买提')).toBeInTheDocument()
    expect(screen.getByText('David Miller')).toBeInTheDocument()
  })
})

describe('状态 Tag', () => {
  test.each(ONE_PER_STATUS.map((o) => [ORDER_STATUS[o.status].label, o]))(
    '%s：名称与颜色来自统一映射',
    (label, order) => {
      const { rowOf } = renderTable([order])
      const tag = within(rowOf(order)).getByText(label)
      const { color } = ORDER_STATUS[order.status]
      expect(tag).toHaveClass(`ant-tag-${color}`)
    },
  )

  test('未知状态显示原始编码且不提供续卡', () => {
    const order = { ...byName('张伟'), status: 'refunded' }
    const { rowOf } = renderTable([order])
    expect(within(rowOf(order)).getByText('refunded')).toBeInTheDocument()
    expect(
      within(rowOf(order)).queryByRole('button', { name: /续卡/ }),
    ).toBeNull()
  })
})

describe('续卡入口', () => {
  test('只有已到期的行显示续卡按钮', () => {
    const { rowOf } = renderTable(ONE_PER_STATUS)
    for (const order of ONE_PER_STATUS) {
      const button = within(rowOf(order)).queryByRole('button', {
        name: /续\s*卡/,
      })
      if (order.status === 'expired') expect(button).toBeInTheDocument()
      else expect(button).toBeNull()
    }
  })

  test('点击续卡把该行订单交给页面', async () => {
    const onRenew = vi.fn()
    const order = byName('王建国')
    const { rowOf } = renderTable([order], { onRenew })
    await userEvent.click(
      within(rowOf(order)).getByRole('button', { name: /续\s*卡/ }),
    )
    expect(onRenew).toHaveBeenCalledWith(order)
  })

  test('使用订单 ID 作为行 key', () => {
    const order = byName('王建国')
    const { rowOf } = renderTable([order])
    expect(rowOf(order)).toHaveAttribute('data-row-key', order.id)
  })
})

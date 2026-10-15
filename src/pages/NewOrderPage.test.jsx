import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, test } from 'vitest'
import AppProviders from '../AppProviders'
import { resetMockDb } from '../mock/db'
import { routes } from '../router/routes'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK } from '../test/fixtures'

const initial = useAuthStore.getState()

function openForm() {
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  const router = createMemoryRouter(routes, { initialEntries: ['/orders/new'] })
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return {
    router,
    name: () => screen.getByLabelText('会员姓名'),
    phone: () => screen.getByLabelText('联系手机号'),
    years: () => screen.getByLabelText('购卡年限'),
    remark: () => screen.getByLabelText('备注'),
    fee: () => screen.getByTestId('fee').textContent,
  }
}

/** 字段下方当前显示的错误（没有错误时为 null） */
const errorOf = (input) =>
  input.closest('.ant-form-item').querySelector('.ant-form-item-explain-error')
    ?.textContent ?? null

async function fill(input, value) {
  await userEvent.clear(input)
  if (value !== '') await userEvent.type(input, value)
}

beforeEach(() => {
  resetMockDb()
  localStorage.clear()
  useAuthStore.setState(initial, true)
})

describe('表单字段', () => {
  test('包含全部字段，费用为只读展示', () => {
    const { name, phone, years, remark } = openForm()
    expect(name()).toBeInTheDocument()
    expect(phone()).toBeInTheDocument()
    expect(years()).toBeInTheDocument()
    expect(remark()).toBeInTheDocument()
    expect(screen.getByText('办卡费用')).toBeInTheDocument()
    // 费用区域不是输入框，无法编辑
    expect(
      screen.getByTestId('fee').querySelector('input, textarea'),
    ).toBeNull()
  })

  test('直接点提交：必填字段全部提示', async () => {
    const { name, phone, years, remark } = openForm()
    await userEvent.click(screen.getByRole('button', { name: /提交订单/ }))
    await waitFor(() => expect(errorOf(name())).toBe('请输入会员姓名'))
    expect(errorOf(phone())).toBe('请输入手机号')
    expect(errorOf(years())).toBe('请输入购卡年限')
    expect(errorOf(remark())).toBeNull() // 备注选填
  })
})

describe('会员姓名', () => {
  test.each([
    ['只填了姓（1 个字符）', '周', '会员姓名需为 2–30 个字符'],
    [
      '31 个字符的外籍姓名',
      'Maximilian Alexander Richardson',
      '会员姓名需为 2–30 个字符',
    ],
    ['2 个字符', '周雨', null],
    ['30 个字符的外籍姓名', 'Maximilian Alexander Robertson', null],
  ])('%s', async (_, value, error) => {
    const { name } = openForm()
    await fill(name(), value)
    await waitFor(() => expect(errorOf(name())).toBe(error))
  })
})

describe('联系手机号', () => {
  test.each([
    ['少输一位', '1381652740', '请输入正确的 11 位手机号'],
    ['第二位输错', '12816527409', '请输入正确的 11 位手机号'],
    ['正确号码', '13816527409', null],
  ])('%s', async (_, value, error) => {
    const { phone } = openForm()
    await fill(phone(), value)
    await waitFor(() => expect(errorOf(phone())).toBe(error))
  })
})

describe('购卡年限与实时费用', () => {
  test.each([
    ['1', null, '¥ 1,200.00（1 年 × 1,200.00 元/年）'],
    ['5', null, '¥ 6,000.00（5 年 × 1,200.00 元/年）'],
    ['10', null, '¥ 12,000.00（10 年 × 1,200.00 元/年）'],
  ])('%s 年：可提交，费用随之更新', async (value, error, fee) => {
    const form = openForm()
    await fill(form.years(), value)
    await waitFor(() => expect(form.fee()).toBe(fee))
    expect(errorOf(form.years())).toBe(error)
  })

  test.each([
    ['0', '年限需为 1–10 的整数'],
    ['11', '年限需为 1–10 的整数'],
    ['2.5', '年限需为 1–10 的整数'],
  ])(
    '%s：提示错误且不显示费用（不会被自动改写成合法值）',
    async (value, error) => {
      const form = openForm()
      await fill(form.years(), value)
      await waitFor(() => expect(errorOf(form.years())).toBe(error))
      expect(form.fee()).toBe('请先填写有效的购卡年限')
      await userEvent.tab() // 失焦后输入值保持原样
      expect(form.years()).toHaveValue(value)
    },
  )

  test('先填 5 年再清空：费用回到占位提示，并提示必填', async () => {
    const form = openForm()
    await fill(form.years(), '5')
    await waitFor(() => expect(form.fee()).toContain('6,000.00'))
    await userEvent.clear(form.years())
    await waitFor(() => expect(errorOf(form.years())).toBe('请输入购卡年限'))
    expect(form.fee()).toBe('请先填写有效的购卡年限')
  })

  test('新建订单不打折：5 年为 6,000.00 而不是续卡的 4,800.00', async () => {
    const form = openForm()
    await fill(form.years(), '5')
    await waitFor(() => expect(form.fee()).toContain('6,000.00'))
    expect(form.fee()).not.toContain('4,800.00')
  })
})

describe('备注', () => {
  // 前台常写的说明，重复拼接到指定长度
  const NOTE = '会员要求周末到店领取会员卡，需开具公司抬头发票。'
  const remarkOf = (length) => NOTE.repeat(10).slice(0, length)

  test.each([
    [200, null],
    [201, '备注最多 200 字'],
  ])('%s 字', async (length, error) => {
    const { remark } = openForm()
    await userEvent.click(remark())
    await userEvent.paste(remarkOf(length))
    await waitFor(() => expect(errorOf(remark())).toBe(error))
  })
})

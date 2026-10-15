// 续卡弹窗：前台员工从列表中选订单打开弹窗，经真实请求层与模拟服务续卡，
// 结果通过重新查询核对；网络故障只在传输层模拟（请求未送达 / 响应丢失）。

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import axios, { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import AppProviders from '../AppProviders'
import { http } from '../api/http'
import { createMockAdapter } from '../mock/adapter'
import { resetMockDb } from '../mock/db'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import RenewOrdersModal from './RenewOrdersModal'

const initial = useAuthStore.getState()
const realAdapter = http.defaults.adapter

// 店长在另一台电脑上操作
const managerClient = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
})

// 记录每次续卡请求的幂等键；network 指定下一次续卡请求的网络故障：
// 'unreachable' 请求未到达服务器；'response-lost' 服务器已处理但响应丢失
let sentKeys
let network
beforeEach(() => {
  resetMockDb()
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  sentKeys = []
  network = null
  http.defaults.adapter = async (config) => {
    if (config.url !== '/orders/renew') return realAdapter(config)
    sentKeys.push(config.headers['Idempotency-Key'])
    const fault = network
    network = null
    if (fault === 'unreachable')
      throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    const response = await realAdapter(config)
    if (fault === 'response-lost')
      throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    return response
  }
})
afterEach(() => {
  http.defaults.adapter = realAdapter
  useAuthStore.setState(initial, true)
  vi.restoreAllMocks()
  message.destroy()
})

/** 与员工操作一致：在已到期 Tab 按姓名搜索出订单 */
async function findExpired(memberName) {
  const { data } = await http.get('/orders', {
    params: { tab: 'expired', memberName },
  })
  expect(data.items).toHaveLength(1)
  return data.items[0]
}
/** 按订单号重新查询 */
const reload = async ({ orderNo }) =>
  (await http.get('/orders', { params: { orderNo } })).data.items[0]

async function open(names) {
  const orders = []
  for (const name of names) orders.push(await findExpired(name))
  const onCancel = vi.fn()
  const onSuccess = vi.fn()
  render(
    <AppProviders>
      <RenewOrdersModal
        orders={orders}
        onCancel={onCancel}
        onSuccess={onSuccess}
      />
    </AppProviders>,
  )
  return { orders, onCancel, onSuccess }
}

const yearsInput = () => screen.getByLabelText('续卡年限')
const fees = () => screen.getByTestId('renew-fees').textContent
const confirm = () => screen.getByRole('button', { name: /确认续卡/ })
const cancel = () => screen.getByRole('button', { name: /取\s*消/ })
const yearsError = () =>
  yearsInput()
    .closest('.ant-form-item')
    .querySelector('.ant-form-item-explain-error')?.textContent ?? null

async function setYears(value) {
  await userEvent.clear(yearsInput())
  if (value !== '') await userEvent.type(yearsInput(), value)
}

describe('费用展示', () => {
  test('单条：显示订单号与会员，默认 1 年 1,200.00', async () => {
    const {
      orders: [wang],
    } = await open(['王建国'])
    expect(
      screen.getByText(`订单 ${wang.orderNo}（王建国）`),
    ).toBeInTheDocument()
    expect(yearsInput()).toHaveValue('1')
    expect(fees()).toContain('¥ 1,200.00')
    expect(fees()).not.toContain('八折')
  })

  test('4 年不打折，5 年八折并显示原价', async () => {
    await open(['王建国'])
    await setYears('4')
    expect(fees()).toContain('单笔费用¥ 4,800.00')
    expect(fees()).not.toContain('八折')
    await setYears('5')
    expect(fees()).toContain('¥ 4,800.00（原价 ¥ 6,000.00，已享八折）')
  })

  test('三笔续 5 年：总额 14,400.00，与单条单价一致', async () => {
    await open(['王建国', '李秀英', '陈志强'])
    expect(screen.getByText(/共 3 笔订单/)).toBeInTheDocument()
    await setYears('5')
    expect(fees()).toContain('应付总额¥ 14,400.00（3 笔 × ¥ 4,800.00）')
  })

  test.each([
    ['0', '年限需为 1–10 的整数'],
    ['11', '年限需为 1–10 的整数'],
    ['2.5', '年限需为 1–10 的整数'],
    ['', '请输入续卡年限'],
  ])(
    '年限输入 "%s"：提示错误，不显示价格，不发送请求',
    async (value, error) => {
      const {
        orders: [wang],
        onSuccess,
      } = await open(['王建国'])
      await setYears(value)
      expect(fees()).toBe('请先填写有效的续卡年限')
      await userEvent.click(confirm())
      await waitFor(() => expect(yearsError()).toBe(error))
      expect(sentKeys).toHaveLength(0)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(await reload(wang)).toEqual(wang)
    },
  )
})

describe('提交', () => {
  test('成功：两笔订单续卡，提示并回调结果', async () => {
    const success = vi.spyOn(message, 'success')
    const {
      orders: [wang, li],
      onSuccess,
    } = await open(['王建国', '李秀英'])
    await setYears('5')
    await userEvent.click(confirm())

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess.mock.calls[0][0]).toMatchObject({
      unitPrice: 4800,
      totalPrice: 9600,
    })
    expect(success).toHaveBeenCalledWith('已为 2 笔订单续卡 5 年')
    expect(await reload(wang)).toMatchObject({
      cardYears: 10,
      status: 'pending_review',
      amount: 2400,
    })
    expect(await reload(li)).toMatchObject({
      cardYears: 8,
      status: 'pending_review',
      amount: 3600,
    })
  })

  test('提交中：连点、Esc 都无效，只续一次', async () => {
    const {
      orders: [wang],
      onSuccess,
      onCancel,
    } = await open(['王建国'])
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await userEvent.click(confirm())
    expect(confirm()).toHaveClass('ant-btn-loading')
    expect(cancel()).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

    await userEvent.click(confirm())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys).toHaveLength(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect((await reload(wang)).cardYears).toBe(6)
  })

  test('填了年限后取消：不发送请求，订单不变', async () => {
    const {
      orders: [wang],
      onCancel,
    } = await open(['王建国'])
    await setYears('3')
    await userEvent.click(cancel())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(sentKeys).toHaveLength(0)
    expect(await reload(wang)).toEqual(wang)
  })

  test('店长已先为李秀英续卡：列出订单号与原因，弹窗与年限保留，王建国也不续', async () => {
    const {
      orders: [wang, li],
      onSuccess,
    } = await open(['王建国', '李秀英'])
    // 前台打开弹窗后，店长在另一台电脑上为李秀英续了 1 年
    await act(() =>
      managerClient.post(
        '/orders/renew',
        { orders: [{ id: li.id, version: li.version }], years: 1 },
        {
          headers: {
            'Idempotency-Key': 'c41d8e2a-6b7f-4a35-9e10-58f2b3d7a961',
          },
        },
      ),
    )
    await setYears('3')
    await userEvent.click(confirm())

    await screen.findByText('有 1 笔订单已被修改，请刷新后重试')
    expect(
      screen.getByText(`${li.orderNo}：订单已被他人修改，请刷新后重试`),
    ).toBeInTheDocument()
    expect(yearsInput()).toHaveValue('3')
    expect(confirm()).not.toHaveClass('ant-btn-loading')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(await reload(wang)).toEqual(wang)
    expect((await reload(li)).cardYears).toBe(4) // 只有店长那一次
  })

  test('网络中断请求未送达：提示一次，年限保留；恢复后原样重试成功', async () => {
    const toast = vi.spyOn(message, 'error')
    const {
      orders: [wang],
      onSuccess,
    } = await open(['王建国'])
    await setYears('2')
    network = 'unreachable'
    await userEvent.click(confirm())

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ content: '网络异常，请稍后重试' }),
      ),
    )
    expect(toast).toHaveBeenCalledTimes(1)
    expect(yearsInput()).toHaveValue('2')
    expect(await reload(wang)).toEqual(wang)

    await userEvent.click(confirm())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys[1]).toBe(sentKeys[0])
    expect((await reload(wang)).cardYears).toBe(7)
  })

  test('服务器已续卡但响应丢失：原样重试复用幂等键，不会重复续卡', async () => {
    const {
      orders: [wang],
      onSuccess,
    } = await open(['王建国'])
    await setYears('3')
    network = 'response-lost'
    await userEvent.click(confirm())
    await waitFor(() => expect(confirm()).not.toHaveClass('ant-btn-loading'))
    expect(onSuccess).not.toHaveBeenCalled()

    await userEvent.click(confirm())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys).toEqual([sentKeys[0], sentKeys[0]])
    expect(await reload(wang)).toMatchObject({ cardYears: 8, version: 3 })
  })

  test('失败后改了年限再提交：使用新的幂等键', async () => {
    const {
      orders: [wang],
      onSuccess,
    } = await open(['王建国'])
    await setYears('2')
    network = 'unreachable'
    await userEvent.click(confirm())
    await waitFor(() => expect(confirm()).not.toHaveClass('ant-btn-loading'))

    await setYears('5')
    await userEvent.click(confirm())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys[1]).not.toBe(sentKeys[0])
    expect((await reload(wang)).cardYears).toBe(10)
  })
})

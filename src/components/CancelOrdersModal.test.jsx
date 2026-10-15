// 撤单确认弹窗：前台员工从列表中选出订单打开弹窗，经真实请求层与模拟服务撤单，
// 结果通过重新查询核对；网络故障只在传输层模拟（请求未送达 / 响应丢失）。

import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import CancelOrdersModal from './CancelOrdersModal'

const initial = useAuthStore.getState()
const realAdapter = http.defaults.adapter

// 店长在另一台电脑上操作
const managerClient = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
})

// 记录每次撤单请求的幂等键；network 指定下一次撤单请求的网络故障：
// 'unreachable' 请求未到达服务器；'response-lost' 服务器已处理但响应丢失
let sentKeys
let network
beforeEach(() => {
  resetMockDb()
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  sentKeys = []
  network = null
  http.defaults.adapter = async (config) => {
    if (config.url !== '/orders/cancel') return realAdapter(config)
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

/** 与员工操作一致：在“进行中”按姓名搜索出订单 */
async function findInProgress(memberName) {
  const { data } = await http.get('/orders', {
    params: { tab: 'in_progress', memberName },
  })
  expect(data.items).toHaveLength(1)
  return data.items[0]
}
const reload = async ({ orderNo }) =>
  (await http.get('/orders', { params: { orderNo } })).data.items[0]

async function open(names) {
  const orders = []
  for (const name of names) orders.push(await findInProgress(name))
  const onCancel = vi.fn()
  const onSuccess = vi.fn()
  render(
    <AppProviders>
      <CancelOrdersModal
        orders={orders}
        onCancel={onCancel}
        onSuccess={onSuccess}
      />
    </AppProviders>,
  )
  return { orders, onCancel, onSuccess }
}

const dialog = () => screen.getByRole('dialog')
const confirm = () => screen.getByRole('button', { name: /确认撤单/ })
const back = () => screen.getByRole('button', { name: /再想想/ })
const listedOrderNos = () =>
  [...dialog().querySelectorAll('tr.ant-table-row')].map(
    (tr) => tr.querySelector('td').textContent,
  )

describe('确认内容', () => {
  test('列出全部将撤单的订单号、会员与状态', async () => {
    const { orders } = await open(['曹宇', '黄丽', '潘越'])
    expect(
      within(dialog()).getByText('确认撤销以下 3 笔订单？'),
    ).toBeInTheDocument()
    expect(listedOrderNos()).toEqual(orders.map((o) => o.orderNo))
    expect(within(dialog()).getByText('黄丽')).toBeInTheDocument()
    expect(within(dialog()).getAllByText('待制卡')).toHaveLength(2)
    expect(within(dialog()).getByText('待寄卡')).toBeInTheDocument()
  })

  test('点“再想想”：不发送请求，订单不变', async () => {
    const {
      orders: [cao],
      onCancel,
    } = await open(['曹宇'])
    await userEvent.click(back())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(sentKeys).toHaveLength(0)
    expect(await reload(cao)).toEqual(cao)
  })
})

describe('提交', () => {
  test('确认后两笔订单变为已取消，提示并回调结果', async () => {
    const success = vi.spyOn(message, 'success')
    const {
      orders: [cao, huang],
      onSuccess,
    } = await open(['曹宇', '黄丽'])
    await userEvent.click(confirm())

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(success).toHaveBeenCalledWith('已撤销 2 笔订单')
    expect(await reload(cao)).toMatchObject({ status: 'cancelled', version: 2 })
    expect(await reload(huang)).toMatchObject({
      status: 'cancelled',
      amount: 2400,
    })
  })

  test('提交中：连点确认、Esc 都无效，只撤一次', async () => {
    const {
      orders: [cao],
      onSuccess,
      onCancel,
    } = await open(['曹宇'])
    await userEvent.click(confirm())
    expect(confirm()).toHaveClass('ant-btn-loading')
    expect(back()).toBeDisabled()

    await userEvent.click(confirm())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys).toHaveLength(1)
    expect(onCancel).not.toHaveBeenCalled()
    expect((await reload(cao)).version).toBe(2)
  })

  test('店长已先为黄丽撤单：列出订单号与原因，弹窗保留，曹宇也不撤', async () => {
    const {
      orders: [cao, huang],
      onSuccess,
    } = await open(['曹宇', '黄丽'])
    await act(() =>
      managerClient.post(
        '/orders/cancel',
        { orders: [{ id: huang.id, version: huang.version }] },
        {
          headers: {
            'Idempotency-Key': 'f1a6c3e8-7b20-4d95-8e4a-2c9b5d0f7e13',
          },
        },
      ),
    )
    await userEvent.click(confirm())

    await within(dialog()).findByText('有 1 笔订单已被修改，请刷新后重试')
    expect(
      within(dialog()).getByText(
        `${huang.orderNo}：订单已被他人修改，请刷新后重试`,
      ),
    ).toBeInTheDocument()
    expect(confirm()).not.toHaveClass('ant-btn-loading')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(await reload(cao)).toEqual(cao)
  })

  test('网络中断请求未送达：提示一次，弹窗保留；恢复后重试成功', async () => {
    const toast = vi.spyOn(message, 'error')
    const {
      orders: [cao],
      onSuccess,
    } = await open(['曹宇'])
    network = 'unreachable'
    await userEvent.click(confirm())

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ content: '网络异常，请稍后重试' }),
      ),
    )
    expect(toast).toHaveBeenCalledTimes(1)
    expect(await reload(cao)).toEqual(cao)

    await userEvent.click(confirm())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys[1]).toBe(sentKeys[0])
    expect((await reload(cao)).status).toBe('cancelled')
  })

  test('服务器已撤单但响应丢失：重试复用幂等键，版本只加一次', async () => {
    const {
      orders: [cao],
      onSuccess,
    } = await open(['曹宇'])
    network = 'response-lost'
    await userEvent.click(confirm())
    await waitFor(() => expect(confirm()).not.toHaveClass('ant-btn-loading'))
    expect(onSuccess).not.toHaveBeenCalled()

    await userEvent.click(confirm())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(sentKeys).toEqual([sentKeys[0], sentKeys[0]])
    expect(await reload(cao)).toMatchObject({ status: 'cancelled', version: 2 })
  })
})

// 导出预览弹窗：经真实请求层与模拟服务生成预览；店长的数据修改通过真实接口完成，
// 网络故障只在传输层模拟。

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios, { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import AppProviders from '../AppProviders'
import { http } from '../api/http'
import { createMockAdapter } from '../mock/adapter'
import { resetMockDb } from '../mock/db'
import { useAuthStore } from '../store/authStore'
import { authOf, FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'
import ExportPreviewModal from './ExportPreviewModal'

const initial = useAuthStore.getState()
const realAdapter = http.defaults.adapter

// 店长在另一台电脑上操作
const manager = axios.create({
  baseURL: '/api',
  adapter: createMockAdapter({ delay: 0 }),
  headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
})

// 记录预览请求次数；networkDown = true 时下一次预览请求因网络中断失败
let previewRequests
let networkDown
beforeEach(() => {
  resetMockDb()
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  previewRequests = 0
  networkDown = false
  http.defaults.adapter = (config) => {
    if (config.url !== '/orders/export-preview') return realAdapter(config)
    previewRequests++
    if (networkDown) {
      networkDown = false
      return Promise.reject(
        new AxiosError('Network Error', 'ERR_NETWORK', config),
      )
    }
    return realAdapter(config)
  }
})
afterEach(() => {
  http.defaults.adapter = realAdapter
  useAuthStore.setState(initial, true)
  vi.restoreAllMocks()
})

function open(request) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <AppProviders>
      <ExportPreviewModal
        request={request}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </AppProviders>,
  )
  return { onCancel, onConfirm }
}

const dialog = () => screen.getByRole('dialog')
const confirm = () => screen.getByRole('button', { name: /确认导出/ })
/** 等待预览生成，返回“可导出 N 笔，排除 M 笔”这一行 */
const summary = () =>
  waitFor(() => {
    const line = dialog().querySelector('p[aria-live]')
    expect(line).not.toBeNull()
    return line
  })
const listedOrderNos = () =>
  [...dialog().querySelectorAll('tr.ant-table-row')].map(
    (tr) => tr.querySelector('td').textContent,
  )
const findOrder = async (memberName) =>
  (await http.get('/orders', { params: { memberName } })).data.items[0]

const ALL = {
  scope: 'filtered',
  filters: { tab: 'all', orderNo: '', memberName: '' },
}

describe('预览内容', () => {
  test('全部订单：可导出 12 笔，列出被排除的 24 笔订单号与原因', async () => {
    open(ALL)
    expect(within(dialog()).getByText('导出筛选结果')).toBeInTheDocument()
    expect(await summary()).toHaveTextContent(
      '可导出 12 笔，排除 24 笔（仅“已完成”“已到期”订单可导出）',
    )
    expect(listedOrderNos()).toHaveLength(12)
    expect(
      within(dialog()).getByText('以下 24 笔订单不会导出'),
    ).toBeInTheDocument()
    expect(
      within(dialog()).getByText(
        'FM20261014001：订单状态为「待审核」，仅已完成、已到期订单可导出',
      ),
    ).toBeInTheDocument()
    expect(confirm()).toHaveTextContent('确认导出 12 笔')
  })

  test('勾选王建国、张伟、范思远：可导出 2 笔，范思远被排除', async () => {
    const orders = await Promise.all(
      ['范思远', '王建国', '张伟'].map(findOrder),
    )
    open({ scope: 'selected', ids: orders.map((o) => o.id) })
    expect(within(dialog()).getByText('导出勾选记录')).toBeInTheDocument()
    expect(await summary()).toHaveTextContent('可导出 2 笔，排除 1 笔')
    expect(listedOrderNos()).toEqual(['FM20251108001', 'FM20190309001'])
    expect(
      within(dialog()).getByText(/^FM20261014001：订单状态为「待审核」/),
    ).toBeInTheDocument()
  })

  test('“进行中”没有可导出订单：说明不会生成文件，不能确认', async () => {
    open({ ...ALL, filters: { ...ALL.filters, tab: 'in_progress' } })
    expect(await summary()).toHaveTextContent('可导出 0 笔，排除 18 笔')
    expect(
      within(dialog()).getByText('没有可导出的订单，不会生成文件'),
    ).toBeInTheDocument()
    expect(confirm()).toBeDisabled()
  })

  test('预览生成中显示 loading，不能确认', async () => {
    open(ALL)
    expect(within(dialog()).getByText('正在生成导出预览…')).toBeInTheDocument()
    expect(confirm()).toBeDisabled()
    await summary()
    expect(confirm()).toBeEnabled()
  })
})

describe('确认与取消', () => {
  test('确认后交出本次预览快照：之后店长续了王建国，导出内容也不变，且不再请求', async () => {
    const wang = await findOrder('王建国')
    const { onConfirm } = open({ scope: 'selected', ids: [wang.id] })
    await summary()
    const shown = listedOrderNos()

    // 预览后、确认前，店长为王建国续卡（订单变为待审核）
    await act(() =>
      manager.post(
        '/orders/renew',
        { orders: [{ id: wang.id, version: wang.version }], years: 1 },
        {
          headers: {
            'Idempotency-Key': 'c3f8a1d6-2e94-4b7a-8d05-9f6e3b1c7a28',
          },
        },
      ),
    )
    await userEvent.click(confirm())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    const snapshot = onConfirm.mock.calls[0][0]
    expect(snapshot.scope).toBe('selected')
    expect(snapshot.items.map((o) => o.orderNo)).toEqual(shown)
    expect(snapshot.items[0]).toMatchObject({
      memberName: '王建国',
      status: 'expired',
      cardYears: 5,
    })
    expect(previewRequests).toBe(1)
  })

  test('取消：不交出数据', async () => {
    const { onCancel, onConfirm } = open(ALL)
    await summary()
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

test('网络中断：弹窗内提示并可重试，重试成功后显示预览', async () => {
  networkDown = true
  open(ALL)
  const alert = await within(dialog()).findByText('导出预览加载失败')
  expect(within(dialog()).getByText('网络异常，请稍后重试')).toBeInTheDocument()
  expect(confirm()).toBeDisabled()

  await userEvent.click(
    within(alert.closest('.ant-alert')).getByRole('button', {
      name: /重\s*试/,
    }),
  )
  expect(await summary()).toHaveTextContent('可导出 12 笔')
  await waitFor(() =>
    expect(within(dialog()).queryByText('导出预览加载失败')).toBeNull(),
  )
  expect(previewRequests).toBe(2)
})

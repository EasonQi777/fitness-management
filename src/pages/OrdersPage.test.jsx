import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import axios, { AxiosError, AxiosHeaders } from 'axios'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import AppProviders from '../AppProviders'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { createMockAdapter } from '../mock/adapter'
import { createBulkTestOrders } from '../mock/bulkSeed'
import { resetMockDb } from '../mock/db'
import { routes } from '../router/routes'
import { useAuthStore } from '../store/authStore'
import { parseCsv } from '../test/csv'
import { authOf, FRONT_DESK, MANAGER, tokenFor } from '../test/fixtures'

const initial = useAuthStore.getState()

async function openOrders(url = '/orders') {
  useAuthStore.getState().setAuth(authOf(FRONT_DESK))
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await settled()
  return {
    router,
    search: () => router.state.location.search,
    orderNo: () => screen.getByLabelText('订单号'),
    memberName: () => screen.getByLabelText('会员姓名'),
  }
}

// 记录请求的发出与完成，用来等待“操作触发的查询已结束”
const requests = { started: 0, finished: 0 }
http.interceptors.request.use((config) => {
  requests.started++
  return config
})
http.interceptors.response.use(
  (res) => {
    requests.finished++
    return res
  },
  (err) => {
    requests.finished++
    throw err
  },
)

/** 等待当前所有请求结束、列表不再 loading */
const settled = () =>
  waitFor(
    () => {
      expect(requests.finished).toBe(requests.started)
      // 表格或错误区域之一已渲染
      expect(
        document.querySelector('.ant-table, [role="alert"]'),
      ).not.toBeNull()
      expect(document.querySelector('.ant-spin-spinning')).toBeNull()
    },
    { timeout: 3000 },
  )

/** 执行操作，并等待它触发的查询完成 */
async function andQuery(action) {
  const before = requests.started
  await action()
  await waitFor(() => expect(requests.started).toBeGreaterThan(before), {
    timeout: 3000,
  })
  await settled()
}

const rows = () => [...document.querySelectorAll('tr.ant-table-row')]
// 按表头文字定位列，不受勾选列等列顺序变化影响
const cellOf = (tr, header) => {
  const headers = [...document.querySelectorAll('thead th')]
  const index = headers.findIndex((th) => th.textContent === header)
  return tr.querySelectorAll('td')[index].textContent
}
const names = () => rows().map((tr) => cellOf(tr, '会员姓名'))
const statuses = () => rows().map((tr) => cellOf(tr, '状态'))
const totalText = () =>
  document.querySelector('.ant-pagination-total-text')?.textContent

const clickTab = (label) =>
  andQuery(() => userEvent.click(screen.getByRole('tab', { name: label })))
const submitSearch = () =>
  andQuery(() =>
    userEvent.click(screen.getByRole('button', { name: /查\s*询/ })),
  )

beforeEach(() => {
  resetMockDb()
  localStorage.clear()
  useAuthStore.setState(initial, true)
})
const realAdapter = http.defaults.adapter
afterEach(() => {
  vi.restoreAllMocks()
  http.defaults.adapter = realAdapter
})

/**
 * 下一次订单查询失败（模拟服务异常或网络中断），其余请求照常。
 * 替换 adapter 而非 http.get，请求仍经过拦截器。
 */
function failNextQuery(makeError) {
  http.defaults.adapter = (config) => {
    if (config.url !== '/orders') return realAdapter(config)
    http.defaults.adapter = realAdapter
    return Promise.reject(makeError(config))
  }
}
const serverDown = (config) =>
  new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, {
    status: 500,
    data: createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试'),
  })
const networkDown = (config) =>
  new AxiosError('Network Error', 'ERR_NETWORK', config)

describe('默认列表', () => {
  test('全部订单第 1 页，最新的在前', async () => {
    await openOrders()
    expect(totalText()).toBe('共 36 条')
    expect(rows()).toHaveLength(10)
    expect(names()[0]).toBe('范思远')
    expect(screen.getByRole('tab', { name: '全部', selected: true }))
  })
})

describe('Tab', () => {
  test.each([
    ['进行中', 'in_progress', 18, ['待审核', '待制卡', '待寄卡']],
    ['已到期', 'expired', 6, ['已到期']],
    ['已完成', 'completed', 6, ['已完成']],
    ['已取消', 'cancelled', 6, ['已取消']],
  ])('切换到%s', async (label, key, total, allowed) => {
    const { search } = await openOrders()
    await clickTab(label)
    expect(search()).toBe(`?tab=${key}`)
    expect(totalText()).toBe(`共 ${total} 条`)
    for (const s of statuses()) expect(allowed).toContain(s)
  })

  test('在第 2 页切换 Tab 回到第 1 页', async () => {
    const { search } = await openOrders('/orders?page=2')
    await clickTab('进行中')
    expect(search()).toBe('?tab=in_progress')
  })
})

describe('搜索', () => {
  test('只在输入框打字不会发起查询', async () => {
    const { memberName, search } = await openOrders()
    const get = vi.spyOn(http, 'get')
    await userEvent.type(memberName(), '袁')
    expect(get).not.toHaveBeenCalled()
    expect(search()).toBe('')
    expect(totalText()).toBe('共 36 条')
  })

  test('姓名前后带空格，与去空格后的结果一致', async () => {
    const { memberName, search } = await openOrders()
    await userEvent.type(memberName(), '  袁 ')
    await submitSearch()
    expect(names()).toEqual(['袁志远', '袁思琪'])
    expect(search()).toBe(`?memberName=${encodeURIComponent('袁')}`)
  })

  test('按完整订单号查询', async () => {
    const { orderNo } = await openOrders()
    await userEvent.type(orderNo(), 'FM20261009002')
    await submitSearch()
    expect(names()).toEqual(['袁思琪'])
  })

  test('订单号与姓名同时填写按 AND 查询', async () => {
    const { orderNo, memberName } = await openOrders()
    await userEvent.type(orderNo(), 'FM20261009001')
    await userEvent.type(memberName(), '袁')
    await submitSearch()
    expect(names()).toEqual(['袁志远'])
  })

  test('Tab 与搜索同时生效：进行中有袁姓夫妻，已到期没有', async () => {
    const { memberName } = await openOrders()
    await userEvent.type(memberName(), '袁')
    await submitSearch()
    await clickTab('进行中')
    expect(names()).toEqual(['袁志远', '袁思琪'])
    await clickTab('已到期')
    expect(rows()).toHaveLength(0)
    expect(document.querySelector('.ant-empty-description')).toHaveTextContent(
      '没有符合条件的订单',
    )
  })

  test('在第 2 页提交搜索回到第 1 页', async () => {
    const { memberName, search } = await openOrders('/orders?page=2')
    await userEvent.type(memberName(), '王')
    await submitSearch()
    expect(search()).toBe(`?memberName=${encodeURIComponent('王')}`)
  })

  test('条件未变时再次点击查询会重新查询', async () => {
    await openOrders()
    const get = vi.spyOn(http, 'get')
    await submitSearch()
    expect(get).toHaveBeenCalledTimes(1)
  })

  test('回车提交搜索', async () => {
    const { memberName } = await openOrders()
    await andQuery(() => userEvent.type(memberName(), 'david{Enter}'))
    expect(names()).toEqual(['David Miller'])
  })
})

describe('重置', () => {
  test('清空两个搜索框、回到第 1 页，保留 Tab 与每页数量', async () => {
    const { search, orderNo, memberName } = await openOrders(
      '/orders?tab=in_progress&orderNo=FM20261009001&memberName=%E8%A2%81&page=1&pageSize=20',
    )
    expect(memberName()).toHaveValue('袁')
    await andQuery(() =>
      userEvent.click(screen.getByRole('button', { name: /重\s*置/ })),
    )
    expect(orderNo()).toHaveValue('')
    expect(memberName()).toHaveValue('')
    expect(search()).toBe('?tab=in_progress&pageSize=20')
    expect(totalText()).toBe('共 18 条')
  })
})

describe('分页', () => {
  test('翻到第 2 页', async () => {
    const { search } = await openOrders()
    await andQuery(() => userEvent.click(screen.getByTitle('2')))
    expect(search()).toBe('?page=2')
    expect(rows()).toHaveLength(10)
    expect(names()).not.toContain('范思远')
  })

  test.each([
    ['20 条/页', 20, 20],
    ['50 条/页', 50, 36],
  ])('切换到 %s', async (option, size, count) => {
    const { search } = await openOrders('/orders?page=3')
    const changer = document.querySelector('.ant-pagination-options')
    await userEvent.click(within(changer).getByRole('combobox'))
    await andQuery(async () =>
      userEvent.click(await screen.findByTitle(option)),
    )
    expect(search()).toBe(`?pageSize=${size}`) // 回到第 1 页
    expect(rows()).toHaveLength(count)
  })
})

describe('浏览器前进后退', () => {
  test('后退恢复上一次的条件、结果与输入框内容', async () => {
    const { router, memberName } = await openOrders()
    await userEvent.type(memberName(), '袁')
    await submitSearch()
    await clickTab('已到期')
    expect(rows()).toHaveLength(0)

    await andQuery(() => act(() => router.navigate(-1)))
    expect(names()).toEqual(['袁志远', '袁思琪'])
    expect(memberName()).toHaveValue('袁')

    await andQuery(() => act(() => router.navigate(-1)))
    expect(totalText()).toBe('共 36 条')
    expect(memberName()).toHaveValue('')
  })
})

describe('加载、空结果与失败', () => {
  test('查询中显示加载提示', async () => {
    useAuthStore.getState().setAuth(authOf(FRONT_DESK))
    const router = createMemoryRouter(routes, { initialEntries: ['/orders'] })
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    expect(await screen.findByText('查询中…')).toBeInTheDocument()
    await settled()
    expect(screen.queryByText('查询中…')).not.toBeInTheDocument()
  })

  test('搜索不存在的会员显示“没有符合条件的订单”', async () => {
    const { memberName } = await openOrders()
    await userEvent.type(memberName(), '诸葛')
    await submitSearch()
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('没有符合条件的订单')).toBeInTheDocument()
  })

  test('切换到已到期时服务异常：显示错误与重试，不展示之前的全部订单', async () => {
    const toast = vi.spyOn(message, 'error')
    await openOrders()
    expect(rows()).toHaveLength(10)

    failNextQuery(serverDown)
    await clickTab('已到期')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('订单加载失败')
    expect(alert).toHaveTextContent('服务异常，请稍后重试')
    expect(rows()).toHaveLength(0)
    expect(screen.queryByText('范思远')).not.toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled() // 错误只提示一次
  })

  test('重试沿用已提交的条件，而不是输入框里还没提交的草稿', async () => {
    const { memberName, search } = await openOrders('/orders?tab=expired')
    failNextQuery(networkDown)
    await submitSearch()
    expect(screen.getByRole('alert')).toHaveTextContent('网络异常')

    await userEvent.type(memberName(), '袁') // 只输入、未提交
    await andQuery(() =>
      userEvent.click(screen.getByRole('button', { name: /重\s*试/ })),
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(search()).toBe('?tab=expired')
    expect(rows()).toHaveLength(6)
    expect(statuses().every((s) => s === '已到期')).toBe(true)
  })

  test('服务恢复后重试成功；仍异常时继续显示错误', async () => {
    await openOrders()
    failNextQuery(serverDown)
    await submitSearch()
    failNextQuery(serverDown)
    await andQuery(() =>
      userEvent.click(screen.getByRole('button', { name: /重\s*试/ })),
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await andQuery(() =>
      userEvent.click(screen.getByRole('button', { name: /重\s*试/ })),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(totalText()).toBe('共 36 条')
  })
})

describe('跨页、跨状态勾选', () => {
  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const toggle = (name) =>
    userEvent.click(within(rowOf(name)).getByRole('checkbox'))
  const isChecked = (name) => within(rowOf(name)).getByRole('checkbox').checked
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const goToPage = (n) =>
    andQuery(() => userEvent.click(screen.getByTitle(String(n))))
  const openDrawer = async () => {
    await userEvent.click(screen.getByRole('button', { name: '查看已选' }))
    return screen.findByRole('dialog')
  }
  const drawerOrderNos = (drawer) =>
    [...drawer.querySelectorAll('tr.ant-table-row')].map(
      (tr) => tr.querySelector('td').textContent,
    )

  test('第 1 页选 2 条、第 2 页选 1 条，共 3 条；翻回第 1 页仍是勾选状态', async () => {
    await openOrders()
    await toggle('范思远')
    await toggle('杜娟')
    await goToPage(2)
    await toggle('曹宇')
    expect(selectedCount()).toBe(3)

    await goToPage(1)
    expect(isChecked('范思远')).toBe(true)
    expect(isChecked('杜娟')).toBe(true)
    expect(isChecked('余辉')).toBe(false)
  })

  test('修改每页数量保留选择', async () => {
    await openOrders()
    await toggle('范思远')
    await goToPage(2)
    await toggle('曹宇')

    const changer = document.querySelector('.ant-pagination-options')
    await userEvent.click(within(changer).getByRole('combobox'))
    await andQuery(async () =>
      userEvent.click(await screen.findByTitle('50 条/页')),
    )
    expect(selectedCount()).toBe(2)
    expect(isChecked('范思远')).toBe(true)
    expect(isChecked('曹宇')).toBe(true)
  })

  test('取消勾选从选择中移除', async () => {
    await openOrders()
    await toggle('范思远')
    await toggle('杜娟')
    await toggle('范思远')
    expect(selectedCount()).toBe(1)
  })

  test('表头全选只选中当前页 10 条，并说明“全选当前页”', async () => {
    await openOrders()
    const header = document.querySelector('thead .ant-checkbox-input')
    await userEvent.hover(header)
    expect(await screen.findByText('全选当前页')).toBeInTheDocument()

    await userEvent.click(header)
    expect(selectedCount()).toBe(10)
    await goToPage(2)
    expect(rows().every((tr) => !tr.querySelector('input').checked)).toBe(true)
  })

  test('在“全部”勾选后切换到“进行中”，勾选保留，可继续勾选其他状态的订单', async () => {
    await openOrders()
    await toggle('范思远') // 待审核
    await toggle('潘越') // 待制卡
    await clickTab('进行中')
    expect(selectedCount()).toBe(2)
    expect(isChecked('范思远')).toBe(true)
    expect(isChecked('潘越')).toBe(true)

    await clickTab('已到期')
    await toggle('王建国')
    expect(selectedCount()).toBe(3)

    await clickTab('全部')
    expect(isChecked('范思远')).toBe(true)
  })

  test('提交搜索与重置都不清空勾选', async () => {
    await openOrders()
    await toggle('范思远')
    await userEvent.type(screen.getByLabelText('会员姓名'), '袁')
    await submitSearch()
    await toggle('袁思琪')
    expect(selectedCount()).toBe(2)

    await andQuery(() =>
      userEvent.click(screen.getByRole('button', { name: /重\s*置/ })),
    )
    expect(selectedCount()).toBe(2)
    expect(isChecked('范思远')).toBe(true)
    expect(isChecked('袁思琪')).toBe(true)
  })

  test('浏览器前进后退不影响勾选', async () => {
    const { router } = await openOrders()
    await toggle('范思远')
    await clickTab('已到期')
    await toggle('王建国')
    await andQuery(() => act(() => router.navigate(-1)))
    expect(selectedCount()).toBe(2)
    expect(isChecked('范思远')).toBe(true)
  })

  test('查看已选：列出不同状态、不同页的全部已选订单', async () => {
    await openOrders()
    await toggle('范思远')
    await clickTab('已到期')
    await toggle('王建国')
    await clickTab('已取消')
    await toggle('郑凯')

    const drawer = await openDrawer()
    expect(within(drawer).getByText('已选订单（3）')).toBeInTheDocument()
    expect(drawerOrderNos(drawer)).toEqual([
      'FM20261014001',
      'FM20190309001',
      'FM20260719001',
    ])
    expect(within(drawer).getByText('待审核')).toBeInTheDocument()
    expect(within(drawer).getByText('已到期')).toBeInTheDocument()
    expect(within(drawer).getByText('已取消')).toBeInTheDocument()
  })

  test('在已选列表中移除一笔，当前页勾选同步取消', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await toggle('李秀英')

    const drawer = await openDrawer()
    await userEvent.click(
      within(drawer).getByRole('button', { name: '移除 FM20190309001' }),
    )
    expect(drawerOrderNos(drawer)).toEqual(['FM20200721001'])
    expect(selectedCount()).toBe(1)
    expect(isChecked('王建国')).toBe(false)
    expect(isChecked('李秀英')).toBe(true)
  })

  test('清空选择：页面与已选列表都清空', async () => {
    await openOrders()
    await toggle('范思远')
    await goToPage(2)
    await toggle('曹宇')
    await userEvent.click(screen.getByRole('button', { name: '清空选择' }))
    expect(selectedCount()).toBe(0)
    expect(isChecked('曹宇')).toBe(false)
    expect(screen.getByRole('button', { name: '清空选择' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看已选' })).toBeDisabled()
    await goToPage(1)
    expect(isChecked('范思远')).toBe(false)
  })

  test('已选列表中“清空全部”', async () => {
    await openOrders()
    await toggle('范思远')
    await toggle('杜娟')
    const drawer = await openDrawer()
    await userEvent.click(
      within(drawer).getByRole('button', { name: /清空全部/ }),
    )
    expect(within(drawer).getByText('还没有勾选订单')).toBeInTheDocument()
    expect(selectedCount()).toBe(0)
  })
})

describe('批量测试数据集：跨页操作准备', () => {
  beforeEach(() => resetMockDb(createBulkTestOrders()))

  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const selectCurrentPage = () =>
    userEvent.click(document.querySelector('thead .ant-checkbox-input'))
  const goToPage = (n) =>
    andQuery(() => userEvent.click(screen.getByTitle(String(n))))
  const tickRow = (index) =>
    userEvent.click(within(rows()[index]).getByRole('checkbox'))

  test('直接打开“已到期第 2 页”链接，恢复对应结果', async () => {
    const { search } = await openOrders('/orders?tab=expired&page=2')
    expect(search()).toBe('?tab=expired&page=2')
    expect(screen.getByRole('tab', { name: '已到期', selected: true }))
    expect(rows()).toHaveLength(5)
    expect(totalText()).toBe('共 15 条')
  })

  test('跨两页勾选 12 笔已到期订单，“查看已选”中全部为已到期', async () => {
    await openOrders('/orders?tab=expired')
    await selectCurrentPage()
    await goToPage(2)
    await tickRow(0)
    await tickRow(1)
    expect(selectedCount()).toBe(12)

    await userEvent.click(screen.getByRole('button', { name: '查看已选' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('已选订单（12）')).toBeInTheDocument()
    const statusCells = [...drawer.querySelectorAll('tr.ant-table-row')].map(
      (tr) => tr.querySelectorAll('td')[2].textContent,
    )
    expect(statusCells).toHaveLength(12)
    expect(statusCells.every((s) => s === '已到期')).toBe(true)
  })

  test('在“进行中”两页中勾选全部 13 笔待制卡 / 待寄卡订单', async () => {
    await openOrders('/orders?tab=in_progress')
    const tickCancellable = async () => {
      for (const [i, tr] of rows().entries())
        if (['待制卡', '待寄卡'].includes(cellOf(tr, '状态'))) await tickRow(i)
    }
    await tickCancellable()
    await goToPage(2)
    await tickCancellable()
    expect(selectedCount()).toBe(13)
  })
})

describe('查询竞态', () => {
  test('快速连续切换 Tab，最终只显示最后一次选择的结果', async () => {
    await openOrders()
    const tab = (name) => screen.getByRole('tab', { name })
    await andQuery(async () => {
      await userEvent.click(tab('已到期'))
      await userEvent.click(tab('已完成'))
      await userEvent.click(tab('已取消'))
    })
    expect(screen.getByRole('tab', { name: '已取消', selected: true }))
    expect(totalText()).toBe('共 6 条')
    expect(statuses().every((s) => s === '已取消')).toBe(true)
  })
})

describe('续卡', () => {
  // 店长在另一台电脑上操作
  const manager = axios.create({
    baseURL: '/api',
    adapter: createMockAdapter({ delay: 0 }),
    headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
  })

  // 记录续卡请求；network = 'unreachable' 时下一次续卡请求无法送达服务器
  let renewRequests
  let network
  beforeEach(() => {
    renewRequests = 0
    network = null
    http.defaults.adapter = (config) => {
      if (config.url !== '/orders/renew') return realAdapter(config)
      renewRequests++
      if (network === 'unreachable') {
        network = null
        return Promise.reject(
          new AxiosError('Network Error', 'ERR_NETWORK', config),
        )
      }
      return realAdapter(config)
    }
  })
  afterEach(() => message.destroy())

  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const toggle = (name) =>
    userEvent.click(within(rowOf(name)).getByRole('checkbox'))
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const goToPage = (n) =>
    andQuery(() => userEvent.click(screen.getByTitle(String(n))))
  const batchButton = () => screen.getByRole('button', { name: '批量续卡' })
  const yearsInput = () => screen.getByLabelText('续卡年限')
  const renewDialog = () => yearsInput().closest('.ant-modal')

  async function setYears(value) {
    await userEvent.clear(yearsInput())
    await userEvent.type(yearsInput(), value)
  }
  /** 确认续卡，等待弹窗关闭与列表刷新完成 */
  async function confirmAndWait() {
    await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))
    await waitFor(
      () => expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument(),
      { timeout: 3000 },
    )
    await settled()
  }
  /** 店长按姓名查询到的订单 */
  const findAsManager = async (memberName, tab = 'all') =>
    (await manager.get('/orders', { params: { tab, memberName } })).data.items

  test('单条续卡：已到期中点王建国的“续卡”，续 5 年后从已到期消失，进行中可查到', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.click(
      within(rowOf('王建国')).getByRole('button', { name: /续\s*卡/ }),
    )
    expect(
      within(renewDialog()).getByText('订单 FM20190309001（王建国）'),
    ).toBeInTheDocument()
    await setYears('5')
    expect(within(renewDialog()).getByText(/已享八折/)).toBeInTheDocument()
    await confirmAndWait()

    expect(names()).not.toContain('王建国')
    expect(totalText()).toBe('共 5 条')
    await clickTab('进行中')
    await userEvent.type(screen.getByLabelText('会员姓名'), '王建国')
    await submitSearch()
    expect(names()).toEqual(['王建国'])
    expect(cellOf(rowOf('王建国'), '购卡年限')).toBe('10 年')
    expect(cellOf(rowOf('王建国'), '状态')).toBe('待审核')
    expect(cellOf(rowOf('王建国'), '订单金额（元）')).toBe('2,400.00')
  })

  test('单条续卡不影响已勾选的其他订单', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('李秀英')
    await userEvent.click(
      within(rowOf('王建国')).getByRole('button', { name: /续\s*卡/ }),
    )
    await confirmAndWait()
    expect(selectedCount()).toBe(1)
  })

  test('未勾选订单时“批量续卡”不可用', async () => {
    await openOrders()
    expect(batchButton()).toBeDisabled()
  })

  test('勾选中有待审核订单：“批量续卡”不可用，提示并列出该订单；取消勾选后恢复', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('王建国')
    expect(batchButton()).toBeEnabled()

    await clickTab('全部')
    await toggle('范思远') // 待审核
    expect(batchButton()).toBeDisabled()
    expect(
      screen.getByText('已选中有 1 笔不是已到期订单，不能批量续卡'),
    ).toBeInTheDocument()
    await userEvent.hover(batchButton().parentElement)
    expect(
      await screen.findByText(
        '仅已到期订单可续卡，请移除：FM20261014001（范思远，待审核）',
      ),
    ).toBeInTheDocument()

    await userEvent.click(batchButton())
    expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument()
    expect(renewRequests).toBe(0)

    await toggle('范思远')
    expect(batchButton()).toBeEnabled()
    expect(screen.queryByText(/不能批量续卡/)).not.toBeInTheDocument()
    expect(selectedCount()).toBe(1)
  })

  test('勾选后店长先续了李秀英：接口拒绝，弹窗列出原因，勾选与年限都保留', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await toggle('李秀英')
    const [li] = await findAsManager('李秀英', 'expired')
    await act(() =>
      manager.post(
        '/orders/renew',
        { orders: [{ id: li.id, version: li.version }], years: 1 },
        {
          headers: {
            'Idempotency-Key': 'd2c7e9a4-5f18-4b3e-8a6d-1e9f0b7c3a52',
          },
        },
      ),
    )

    await userEvent.click(batchButton())
    await setYears('3')
    await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))

    expect(
      await within(renewDialog()).findByText(
        'FM20200721001：订单已被他人修改，请刷新后重试',
      ),
    ).toBeInTheDocument()
    expect(yearsInput()).toHaveValue('3')
    expect(selectedCount()).toBe(2)
    expect((await findAsManager('王建国', 'expired'))[0].cardYears).toBe(5)
  })

  test('网络中断：续卡失败，弹窗、年限与勾选都保留；恢复后重试成功', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await toggle('李秀英')
    await userEvent.click(batchButton())
    await setYears('2')
    network = 'unreachable'
    await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))

    expect(await screen.findByText('网络异常，请稍后重试')).toBeInTheDocument()
    expect(yearsInput()).toHaveValue('2')
    expect(selectedCount()).toBe(2)
    expect((await findAsManager('王建国', 'expired'))[0].cardYears).toBe(5)

    await confirmAndWait()
    expect(selectedCount()).toBe(0)
    expect(totalText()).toBe('共 4 条')
    expect(renewRequests).toBe(2)
  })

  test('取消续卡弹窗：订单与勾选不变', async () => {
    await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await userEvent.click(batchButton())
    await setYears('3')
    await userEvent.click(
      within(renewDialog()).getByRole('button', { name: /取\s*消/ }),
    )
    expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument()
    expect(renewRequests).toBe(0)
    expect(selectedCount()).toBe(1)
    expect(totalText()).toBe('共 6 条')
  })

  describe('批量测试数据集', () => {
    beforeEach(() => resetMockDb(createBulkTestOrders()))

    test('跨两页勾选 12 笔已到期订单续 5 年：总额 57,600.00，成功后清空勾选，只剩 3 笔已到期', async () => {
      await openOrders('/orders?tab=expired')
      await userEvent.click(document.querySelector('thead .ant-checkbox-input'))
      await goToPage(2)
      await userEvent.click(within(rows()[0]).getByRole('checkbox'))
      await userEvent.click(within(rows()[1]).getByRole('checkbox'))
      expect(selectedCount()).toBe(12)

      await userEvent.click(batchButton())
      expect(
        within(renewDialog()).getByText(/共 12 笔订单/),
      ).toBeInTheDocument()
      await setYears('5')
      expect(within(renewDialog()).getByTestId('renew-fees')).toHaveTextContent(
        '应付总额¥ 57,600.00（12 笔 × ¥ 4,800.00）',
      )
      await confirmAndWait()

      expect(selectedCount()).toBe(0)
      expect(batchButton()).toBeDisabled()
      // 第 2 页的订单都已续卡，自动回到第 1 页，剩余 3 笔
      await waitFor(() => expect(rows()).toHaveLength(3))
      expect(totalText()).toBe('共 3 条')
      expect(renewRequests).toBe(1)
      await clickTab('进行中')
      expect(totalText()).toBe('共 27 条')
    })
  })
})

describe('批量撤单', () => {
  // 店长在另一台电脑上操作
  const manager = axios.create({
    baseURL: '/api',
    adapter: createMockAdapter({ delay: 0 }),
    headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
  })

  let cancelRequests
  beforeEach(() => {
    cancelRequests = 0
    http.defaults.adapter = (config) => {
      if (config.url === '/orders/cancel') cancelRequests++
      return realAdapter(config)
    }
  })
  afterEach(() => message.destroy())

  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const toggle = (name) =>
    userEvent.click(within(rowOf(name)).getByRole('checkbox'))
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const goToPage = (n) =>
    andQuery(() => userEvent.click(screen.getByTitle(String(n))))
  const cancelButton = () => screen.getByRole('button', { name: '批量撤单' })
  const confirmDialog = () =>
    screen.getByRole('button', { name: /确认撤单/ }).closest('.ant-modal')
  const listedOrderNos = () =>
    [...confirmDialog().querySelectorAll('tr.ant-table-row')].map(
      (tr) => tr.querySelector('td').textContent,
    )
  /** 确认撤单，等待弹窗关闭与列表刷新完成 */
  async function confirmAndWait() {
    await userEvent.click(screen.getByRole('button', { name: /确认撤单/ }))
    await waitFor(
      () =>
        expect(
          screen.queryByRole('button', { name: /确认撤单/ }),
        ).not.toBeInTheDocument(),
      { timeout: 3000 },
    )
    await settled()
  }

  test('未勾选订单时“批量撤单”不可用', async () => {
    await openOrders()
    expect(cancelButton()).toBeDisabled()
  })

  test('勾选中有待审核订单：“批量撤单”不可用并列出该订单；取消勾选后恢复', async () => {
    await openOrders('/orders?tab=in_progress')
    await toggle('谢婉婷') // 待制卡
    expect(cancelButton()).toBeEnabled()

    await toggle('范思远') // 待审核
    expect(cancelButton()).toBeDisabled()
    expect(
      screen.getByText('已选中有 1 笔不是待制卡或待寄卡订单，不能批量撤单'),
    ).toBeInTheDocument()
    await userEvent.hover(cancelButton().parentElement)
    expect(
      await screen.findByText(
        '仅待制卡、待寄卡订单可撤单，请移除：FM20261014001（范思远，待审核）',
      ),
    ).toBeInTheDocument()

    await toggle('范思远')
    expect(cancelButton()).toBeEnabled()
  })

  test('确认框中点“再想想”：不发送请求，勾选保留', async () => {
    await openOrders('/orders?tab=in_progress')
    await toggle('谢婉婷')
    await toggle('彭飞')
    await userEvent.click(cancelButton())
    expect(listedOrderNos()).toEqual(['FM20261008001', 'FM20261007001'])

    await userEvent.click(screen.getByRole('button', { name: /再想想/ }))
    expect(cancelRequests).toBe(0)
    expect(selectedCount()).toBe(2)
    expect(totalText()).toBe('共 18 条')
  })

  test('店长已先撤了彭飞：整批被拒，列出原因，勾选保留，谢婉婷仍为待制卡', async () => {
    await openOrders('/orders?tab=in_progress')
    await toggle('谢婉婷')
    await toggle('彭飞')
    const [peng] = (
      await manager.get('/orders', { params: { memberName: '彭飞' } })
    ).data.items
    await act(() =>
      manager.post(
        '/orders/cancel',
        { orders: [{ id: peng.id, version: peng.version }] },
        {
          headers: {
            'Idempotency-Key': '8c2f5a17-e940-4b6d-a3c1-7d0e9b4f2a68',
          },
        },
      ),
    )

    await userEvent.click(cancelButton())
    await userEvent.click(screen.getByRole('button', { name: /确认撤单/ }))
    expect(
      await within(confirmDialog()).findByText(
        'FM20261007001：订单已被他人修改，请刷新后重试',
      ),
    ).toBeInTheDocument()
    expect(selectedCount()).toBe(2)
    const [xie] = (
      await manager.get('/orders', { params: { memberName: '谢婉婷' } })
    ).data.items
    expect(xie.status).toBe('pending_card')
  })

  describe('批量测试数据集', () => {
    beforeEach(() => resetMockDb(createBulkTestOrders()))

    test('跨两页勾选全部 13 笔待制卡 / 待寄卡订单：确认框列出全部，撤单后进行中只剩待审核', async () => {
      await openOrders('/orders?tab=in_progress')
      const picked = []
      const tickCancellable = async () => {
        for (const tr of rows())
          if (['待制卡', '待寄卡'].includes(cellOf(tr, '状态'))) {
            picked.push(cellOf(tr, '订单号'))
            await userEvent.click(within(tr).getByRole('checkbox'))
          }
      }
      await tickCancellable()
      await goToPage(2)
      await tickCancellable()
      expect(selectedCount()).toBe(13)

      await userEvent.click(cancelButton())
      expect(
        within(confirmDialog()).getByText('确认撤销以下 13 笔订单？'),
      ).toBeInTheDocument()
      expect(listedOrderNos()).toEqual(picked)

      await confirmAndWait()
      expect(cancelRequests).toBe(1)
      expect(selectedCount()).toBe(0)
      expect(cancelButton()).toBeDisabled()
      // 刷新后进行中只剩 2 笔：第 2 页已无数据，自动回到第 1 页
      await waitFor(() => expect(rows()).toHaveLength(2))
      expect(totalText()).toBe('共 2 条')
      expect(statuses()).toEqual(['待审核', '待审核'])
      await clickTab('已取消')
      expect(totalText()).toBe('共 14 条')
    })
  })
})

describe('写入后的列表', () => {
  // 记录写请求；listDown = true 时下一次列表查询因网络中断失败
  let writeRequests
  let listDown
  beforeEach(() => {
    writeRequests = 0
    listDown = false
    http.defaults.adapter = (config) => {
      if (config.method === 'post') writeRequests++
      if (config.url === '/orders' && config.method === 'get' && listDown) {
        listDown = false
        return Promise.reject(networkDown(config))
      }
      return realAdapter(config)
    }
  })
  afterEach(() => message.destroy())

  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const confirmRenew = () =>
    userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))

  describe('批量测试数据集', () => {
    beforeEach(() => resetMockDb(createBulkTestOrders()))

    test('已到期第 2 页的 5 笔全部续卡后，自动回到第 1 页，后退不会回到空页', async () => {
      const { router, search } = await openOrders('/orders?tab=expired&page=2')
      expect(rows()).toHaveLength(5)
      await userEvent.click(document.querySelector('thead .ant-checkbox-input'))
      expect(selectedCount()).toBe(5)

      await userEvent.click(screen.getByRole('button', { name: '批量续卡' }))
      await confirmRenew()

      await waitFor(() => expect(search()).toBe('?tab=expired'), {
        timeout: 3000,
      })
      await waitFor(() => expect(rows()).toHaveLength(10), { timeout: 3000 })
      expect(totalText()).toBe('共 10 条')
      expect(
        document.querySelector('.ant-pagination-item-active').textContent,
      ).toBe('1')
      // 纠正页码替换了当前历史记录
      expect(router.state.historyAction).toBe('REPLACE')
    })
  })

  test('续卡成功但列表刷新失败：说明续卡已成功，重新加载只查询列表、不再续卡', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.click(
      within(rowOf('王建国')).getByRole('button', { name: /续\s*卡/ }),
    )
    listDown = true
    await confirmRenew()

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('1 笔订单续卡已成功，但订单列表刷新失败')
    expect(alert).toHaveTextContent(
      '网络异常，请稍后重试。点击“重新加载列表”只会重新查询，不会重复执行操作。',
    )
    expect(writeRequests).toBe(1)

    await andQuery(() =>
      userEvent.click(
        within(alert).getByRole('button', { name: '重新加载列表' }),
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(names()).not.toContain('王建国')
    expect(totalText()).toBe('共 5 条')
    expect(writeRequests).toBe(1)
  })

  test('写入成功后切换到其他 Tab 查询失败：按普通加载失败提示', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.click(
      within(rowOf('王建国')).getByRole('button', { name: /续\s*卡/ }),
    )
    await confirmRenew()
    await waitFor(() => expect(names()).not.toContain('王建国'), {
      timeout: 3000,
    })
    await settled()

    listDown = true
    await clickTab('全部')
    expect(screen.getByRole('alert')).toHaveTextContent('订单加载失败')
    expect(screen.getByRole('alert')).not.toHaveTextContent('续卡已成功')
  })
})

describe('退出与重新登录', () => {
  // sessionExpired = true 时，下一次写请求到达服务器前登录已失效：
  // 去掉认证头交给真实模拟服务，由服务端返回 401
  let sessionExpired
  let writeRequests
  beforeEach(() => {
    sessionExpired = false
    writeRequests = 0
    http.defaults.adapter = async (config) => {
      if (config.method !== 'post' || config.url === '/auth/login')
        return realAdapter(config)
      writeRequests++
      if (!sessionExpired) return realAdapter(config)
      sessionExpired = false
      const headers = new AxiosHeaders(config.headers)
      headers.delete('Authorization')
      try {
        return await realAdapter({ ...config, headers })
      } catch (err) {
        err.config = config // 请求层按发出时携带的 token 判断是否属于当前会话
        throw err
      }
    }
  })
  afterEach(() => message.destroy())

  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const toggle = (name) =>
    userEvent.click(within(rowOf(name)).getByRole('checkbox'))
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)
  const headerLogout = () =>
    within(document.querySelector('.ant-layout-header')).getByRole('button', {
      name: /退出登录/,
    })
  async function loginAs(user) {
    await userEvent.type(await screen.findByLabelText('账号'), user.username)
    await userEvent.type(
      screen.getByLabelText('密码'),
      `${user.password}{Enter}`,
    )
  }

  test('前台跨 Tab 勾选 3 笔后退出，店长登录：看不到前台的勾选', async () => {
    const { router } = await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await toggle('李秀英')
    await clickTab('进行中')
    await toggle('谢婉婷')
    expect(selectedCount()).toBe(3)

    await userEvent.click(headerLogout())
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    await loginAs(MANAGER)
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'))
    await settled()
    expect(screen.getByText('lijun')).toBeInTheDocument()
    expect(selectedCount()).toBe(0)
    expect(screen.getByRole('button', { name: '批量续卡' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '批量撤单' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看已选' })).toBeDisabled()
  })

  test('续卡弹窗中确认时登录已失效：回到登录页且不续卡；店长登录后没有残留弹窗与勾选', async () => {
    const warning = vi.spyOn(message, 'warning')
    const { router } = await openOrders('/orders?tab=expired')
    await toggle('王建国')
    await toggle('李秀英')
    await userEvent.click(screen.getByRole('button', { name: '批量续卡' }))
    await userEvent.clear(screen.getByLabelText('续卡年限'))
    await userEvent.type(screen.getByLabelText('续卡年限'), '3')

    sessionExpired = true
    await userEvent.click(screen.getByRole('button', { name: /确认续卡/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ content: '登录已失效，请重新登录' }),
    )
    expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument()

    await loginAs(MANAGER)
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'))
    await settled()
    expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument()
    expect(selectedCount()).toBe(0)

    // 服务端拒绝了未认证的请求，两笔订单都没有被续卡
    await clickTab('已到期')
    expect(totalText()).toBe('共 6 条')
    expect(cellOf(rowOf('王建国'), '购卡年限')).toBe('5 年')
    expect(cellOf(rowOf('李秀英'), '购卡年限')).toBe('3 年')
    expect(writeRequests).toBe(1)
  })

  test('撤单确认框中确认时登录已失效：订单不变，重新登录后确认框不在', async () => {
    const { router } = await openOrders('/orders?tab=in_progress')
    await toggle('谢婉婷')
    await userEvent.click(screen.getByRole('button', { name: '批量撤单' }))

    sessionExpired = true
    await userEvent.click(screen.getByRole('button', { name: /确认撤单/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    await loginAs(FRONT_DESK)
    await waitFor(() => expect(router.state.location.pathname).toBe('/orders'))
    await settled()
    expect(
      screen.queryByRole('button', { name: /确认撤单/ }),
    ).not.toBeInTheDocument()
    expect(selectedCount()).toBe(0)

    await clickTab('进行中')
    expect(cellOf(rowOf('谢婉婷'), '状态')).toBe('待制卡')
  })
})

describe('导出入口', () => {
  const exportFiltered = () =>
    screen.getByRole('button', { name: '导出筛选结果' })
  const exportSelected = () =>
    screen.getByRole('button', { name: '导出勾选记录' })
  const previewDialog = () =>
    screen.getByRole('button', { name: /确认导出/ }).closest('.ant-modal')
  /** 等待预览生成，返回“可导出 N 笔，排除 M 笔”这一行的文字 */
  const summaryText = () =>
    waitFor(
      () => {
        const line = previewDialog().querySelector('p[aria-live]')
        expect(line).not.toBeNull()
        return line.textContent
      },
      { timeout: 3000 },
    )
  const closePreview = () =>
    userEvent.click(
      within(previewDialog()).getByRole('button', { name: /取\s*消/ }),
    )
  const selectedCount = () =>
    Number(document.querySelector('[aria-live] strong').textContent)

  test('未勾选订单时“导出勾选记录”不可用', async () => {
    await openOrders()
    expect(exportSelected()).toBeDisabled()
    expect(exportFiltered()).toBeEnabled()
  })

  test('“导出筛选结果”按已提交的条件，而不是输入框里未提交的草稿', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.type(screen.getByLabelText('会员姓名'), '王')

    await userEvent.click(exportFiltered())
    expect(await summaryText()).toMatch(/^可导出 6 笔，排除 0 笔/)
    await closePreview()

    await submitSearch()
    await userEvent.click(exportFiltered())
    expect(await summaryText()).toMatch(/^可导出 1 笔，排除 0 笔/)
  })

  test('取消预览：弹窗关闭，勾选保留', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.click(within(rows()[0]).getByRole('checkbox'))
    await userEvent.click(exportSelected())
    await summaryText()
    await closePreview()
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /确认导出/ }),
      ).not.toBeInTheDocument(),
    )
    expect(selectedCount()).toBe(1)
  })

  describe('批量测试数据集', () => {
    beforeEach(() => resetMockDb(createBulkTestOrders()))

    test('跨两页勾选 3 笔已到期订单：预览列出全部 3 笔', async () => {
      await openOrders('/orders?tab=expired')
      const picked = []
      const tick = async (i) => {
        picked.push(cellOf(rows()[i], '订单号'))
        await userEvent.click(within(rows()[i]).getByRole('checkbox'))
      }
      await tick(0)
      await tick(9)
      await andQuery(() => userEvent.click(screen.getByTitle('2')))
      await tick(4)

      await userEvent.click(exportSelected())
      expect(await summaryText()).toMatch(/^可导出 3 笔，排除 0 笔/)
      const listed = [
        ...previewDialog().querySelectorAll('tr.ant-table-row'),
      ].map((tr) => tr.querySelector('td').textContent)
      expect(listed).toEqual(picked)
    })

    test('“导出筛选结果”不受当前页限制：已到期 15 笔全部可导出', async () => {
      await openOrders('/orders?tab=expired')
      expect(rows()).toHaveLength(10)
      await userEvent.click(exportFiltered())
      expect(await summaryText()).toMatch(/^可导出 15 笔，排除 0 笔/)
    })
  })
})

describe('导出下载', () => {
  // jsdom 没有对象 URL 与真实下载：记录页面交给浏览器的文件、创建与释放的对象 URL
  let files
  let revoked
  let createFails
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  }
  beforeEach(() => {
    files = []
    revoked = []
    createFails = false
    URL.createObjectURL = (blob) => {
      if (createFails) throw new Error('Out of memory')
      const url = `blob:http://localhost/${files.length + 1}`
      files.push({ url, blob })
      return url
    }
    URL.revokeObjectURL = (url) => revoked.push(url)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function () {
        const file = files.find((f) => f.url === this.href)
        file.name = this.download
        file.linkInPage = document.body.contains(this)
      },
    )
  })
  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    message.destroy()
  })

  const rowOf = (name) => rows().find((tr) => cellOf(tr, '会员姓名') === name)
  const confirmButton = () => screen.getByRole('button', { name: /确认导出/ })
  /** 打开预览，等预览生成后返回预览中列出的订单号 */
  async function openPreview(buttonName) {
    await userEvent.click(screen.getByRole('button', { name: buttonName }))
    return waitFor(
      () => {
        const modal = confirmButton().closest('.ant-modal')
        expect(modal.querySelector('p[aria-live]')).not.toBeNull()
        return [...modal.querySelectorAll('tr.ant-table-row')].map(
          (tr) => tr.querySelector('td').textContent,
        )
      },
      { timeout: 3000 },
    )
  }
  /** 读取文件：确认 UTF-8 BOM，返回解析后的行 */
  async function read(file) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    return parseCsv(new TextDecoder().decode(bytes)) // 默认解码会去掉 BOM
  }
  const closed = () =>
    waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /确认导出/ }),
      ).not.toBeInTheDocument(),
    )

  test('导出已到期筛选结果：下载 CSV，内容与预览一致，文件名含范围与上海时间', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T15:42:08+08:00'))
    const success = vi.spyOn(message, 'success')
    await openOrders('/orders?tab=expired')
    const previewed = await openPreview('导出筛选结果')
    await userEvent.click(confirmButton())
    vi.useRealTimers()

    expect(files).toHaveLength(1)
    const [file] = files
    expect(file.name).toBe('订单导出_筛选结果_20261015-154208.csv')
    expect(file.blob.type).toBe('text/csv;charset=utf-8')
    const rowsInFile = await read(file)
    expect(rowsInFile[0]).toEqual([
      '订单号',
      '会员姓名',
      '购卡年限',
      '订单金额',
      '状态',
      '创建时间',
    ])
    expect(rowsInFile.slice(1).map((r) => r[0])).toEqual(previewed)
    expect(rowsInFile.slice(1).every((r) => r[4] === '已到期')).toBe(true)
    expect(success).toHaveBeenCalledWith('已导出 6 笔订单')
    await closed()
  })

  test('导出勾选记录：文件名标明勾选记录，只含可导出的订单', async () => {
    await openOrders()
    await userEvent.click(within(rowOf('范思远')).getByRole('checkbox')) // 待审核
    await clickTab('已到期')
    await userEvent.click(within(rowOf('王建国')).getByRole('checkbox'))
    await openPreview('导出勾选记录')
    await userEvent.click(confirmButton())

    expect(files[0].name).toMatch(/^订单导出_勾选记录_\d{8}-\d{6}\.csv$/)
    const rowsInFile = await read(files[0])
    expect(rowsInFile.slice(1).map((r) => r[1])).toEqual(['王建国'])
  })

  test('预览后店长为王建国续了卡：文件仍是确认时预览的内容，不重新读取', async () => {
    await openOrders('/orders?tab=expired')
    await userEvent.click(within(rowOf('王建国')).getByRole('checkbox'))
    await openPreview('导出勾选记录')

    const manager = axios.create({
      baseURL: '/api',
      adapter: createMockAdapter({ delay: 0 }),
      headers: { Authorization: `Bearer ${tokenFor(MANAGER)}` },
    })
    const [wang] = (
      await manager.get('/orders', { params: { memberName: '王建国' } })
    ).data.items
    await act(() =>
      manager.post(
        '/orders/renew',
        { orders: [{ id: wang.id, version: wang.version }], years: 1 },
        {
          headers: {
            'Idempotency-Key': 'e6a2c9f4-8b13-4d70-a5e1-3c7f9d2b6a84',
          },
        },
      ),
    )
    await userEvent.click(confirmButton())

    const [, row] = await read(files[0])
    expect(row.slice(1, 3)).toEqual(['王建国', '5'])
    expect(row[4]).toBe('已到期')
  })

  test('连续导出三次：每次的临时链接都已移除，对象 URL 全部释放', async () => {
    await openOrders('/orders?tab=completed')
    for (let i = 0; i < 3; i++) {
      await openPreview('导出筛选结果')
      await userEvent.click(confirmButton())
      await closed()
    }
    expect(files).toHaveLength(3)
    expect(files.every((f) => f.linkInPage)).toBe(true) // 点击时链接在页面中
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    await waitFor(() => expect(revoked).toEqual(files.map((f) => f.url)))
  })

  test('浏览器无法生成文件：提示失败，预览保留，可再次确认', async () => {
    const error = vi.spyOn(message, 'error')
    await openOrders('/orders?tab=expired')
    const previewed = await openPreview('导出筛选结果')

    createFails = true
    await userEvent.click(confirmButton())
    expect(error).toHaveBeenCalledWith('导出文件生成失败，请重试')
    expect(confirmButton()).toBeEnabled()
    expect(files).toHaveLength(0)

    createFails = false
    await userEvent.click(confirmButton())
    expect(files).toHaveLength(1)
    expect((await read(files[0])).slice(1).map((r) => r[0])).toEqual(previewed)
    await closed()
  })

  test('“进行中”没有可导出订单：不能确认，不生成空文件', async () => {
    await openOrders('/orders?tab=in_progress')
    await openPreview('导出筛选结果')
    expect(confirmButton()).toBeDisabled()
    await userEvent.click(confirmButton())
    expect(files).toHaveLength(0)
  })

  describe('批量测试数据集', () => {
    beforeEach(() => resetMockDb(createBulkTestOrders()))

    test('已到期 15 笔分两页：导出筛选结果的文件包含全部 15 笔', async () => {
      await openOrders('/orders?tab=expired')
      expect(rows()).toHaveLength(10)
      const previewed = await openPreview('导出筛选结果')
      expect(previewed).toHaveLength(15)
      await userEvent.click(confirmButton())

      const rowsInFile = (await read(files[0])).slice(1)
      expect(rowsInFile.map((r) => r[0])).toEqual(previewed)
      expect(rowsInFile.every((r) => r.length === 6 && r[4] === '已到期')).toBe(
        true,
      )
    })
  })
})

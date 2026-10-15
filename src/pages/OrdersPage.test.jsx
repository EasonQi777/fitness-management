import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import axios, { AxiosError } from 'axios'
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

  test('勾选了待审核订单：列出不可续卡的订单，不打开续卡弹窗、不发送请求', async () => {
    await openOrders()
    await toggle('范思远') // 待审核
    await clickTab('已到期')
    await toggle('王建国')
    await userEvent.click(batchButton())

    const dialog = await screen.findByRole('dialog', {
      name: '已选订单中有 1 笔不可续卡',
    })
    expect(
      within(dialog).getByText('FM20261014001（范思远，待审核）'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/王建国/)).toBeNull()
    expect(screen.queryByLabelText('续卡年限')).not.toBeInTheDocument()
    expect(renewRequests).toBe(0)

    await userEvent.click(
      within(dialog).getByRole('button', { name: '知道了' }),
    )
    expect(selectedCount()).toBe(2)
    expect(totalText()).toBe('共 6 条')
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
      expect(totalText()).toBe('共 3 条')
      expect(renewRequests).toBe(1)
      await clickTab('进行中')
      expect(totalText()).toBe('共 27 条')
    })
  })
})

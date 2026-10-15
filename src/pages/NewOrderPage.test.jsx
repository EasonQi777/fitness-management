import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { message, Modal } from 'antd'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import AppProviders from '../AppProviders'
import { createErrorBody } from '../api/errors'
import { http } from '../api/http'
import { db, resetMockDb } from '../mock/db'
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

describe('提交', () => {
  const realAdapter = http.defaults.adapter
  // 记录每次新建请求的幂等键；可按需让某次请求失败
  let sentKeys
  let interceptNext = null
  beforeEach(() => {
    sentKeys = []
    http.defaults.adapter = (config) => {
      if (config.method === 'post' && config.url === '/orders') {
        sentKeys.push(config.headers['Idempotency-Key'])
        const intercept = interceptNext
        interceptNext = null
        if (intercept) return intercept(config)
      }
      return realAdapter(config)
    }
  })
  afterEach(() => {
    http.defaults.adapter = realAdapter
    vi.restoreAllMocks()
    message.destroy()
  })

  async function fillZhou(form) {
    await fill(form.name(), '周雨桐')
    await fill(form.phone(), '13816527409')
    await fill(form.years(), '5')
    await userEvent.type(form.remark(), '朋友推荐，周末到店领卡')
  }
  const submitButton = () => screen.getByRole('button', { name: /提交订单/ })
  const created = () => db.orders.filter((o) => o.phone === '13816527409')

  test('提交成功：提示订单号，进入默认列表第一页，新订单在最前', async () => {
    const success = vi.spyOn(message, 'success')
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())

    await waitFor(() =>
      expect(form.router.state.location.pathname).toBe('/orders'),
    )
    expect(form.router.state.location.search).toBe('')
    expect(success).toHaveBeenCalledWith(
      expect.stringMatching(/^订单 FM\d{11} 创建成功$/),
    )
    expect(created()).toHaveLength(1)
    expect(created()[0]).toMatchObject({
      memberName: '周雨桐',
      cardYears: 5,
      amount: 6000,
      status: 'pending_review',
      remark: '朋友推荐，周末到店领卡',
    })

    // 列表加载完成后新订单位于第一行
    await waitFor(
      () => {
        const first = document.querySelector('tr.ant-table-row')
        expect(first).toHaveTextContent('周雨桐')
        expect(first).toHaveTextContent('6,000.00')
        expect(first).toHaveTextContent('待审核')
      },
      { timeout: 3000 },
    )
  })

  test('提交中显示 loading，连续点击与回车只创建一笔订单', async () => {
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())
    expect(submitButton()).toHaveClass('ant-btn-loading')
    await userEvent.click(submitButton())
    await userEvent.type(form.phone(), '{Enter}')

    await waitFor(() =>
      expect(form.router.state.location.pathname).toBe('/orders'),
    )
    expect(created()).toHaveLength(1)
    expect(sentKeys).toHaveLength(1)
  })

  test('表单验证未通过时不发送请求', async () => {
    const form = openForm()
    await fill(form.name(), '周')
    await userEvent.click(submitButton())
    await waitFor(() => expect(errorOf(form.name())).not.toBeNull())
    expect(sentKeys).toHaveLength(0)
  })

  test('服务端返回字段错误：显示在对应字段，其余输入保留', async () => {
    // 后端新增的规则：同一手机号已有进行中的订单
    interceptNext = (config) =>
      Promise.reject(
        new AxiosError('fail', 'ERR_BAD_REQUEST', config, null, {
          status: 400,
          data: createErrorBody('VALIDATION_ERROR', '订单信息填写有误', {
            fieldErrors: { phone: '该手机号已有进行中的订单' },
          }),
        }),
      )
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())

    await waitFor(() =>
      expect(errorOf(form.phone())).toBe('该手机号已有进行中的订单'),
    )
    expect(form.router.state.location.pathname).toBe('/orders/new')
    expect(form.name()).toHaveValue('周雨桐')
    expect(form.years()).toHaveValue('5')
    expect(form.remark()).toHaveValue('朋友推荐，周末到店领卡')
    expect(submitButton()).not.toHaveClass('ant-btn-loading')
  })

  test('服务异常：只由请求层提示一次，输入全部保留，可再次提交', async () => {
    const toast = vi.spyOn(message, 'error')
    interceptNext = (config) =>
      Promise.reject(
        new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, {
          status: 500,
          data: createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试'),
        }),
      )
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(form.name()).toHaveValue('周雨桐')
    expect(form.phone()).toHaveValue('13816527409')
    expect(created()).toHaveLength(0)

    await userEvent.click(submitButton())
    await waitFor(() =>
      expect(form.router.state.location.pathname).toBe('/orders'),
    )
    expect(created()).toHaveLength(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  test('订单已创建但响应因网络中断丢失：原样重试复用幂等键，不会重复建单', async () => {
    interceptNext = async (config) => {
      await realAdapter(config) // 服务端已处理成功
      throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    }
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())
    await waitFor(() =>
      expect(submitButton()).not.toHaveClass('ant-btn-loading'),
    )
    expect(created()).toHaveLength(1) // 服务端已有订单，页面却不知道

    await userEvent.click(submitButton()) // 员工再次点击提交
    await waitFor(() =>
      expect(form.router.state.location.pathname).toBe('/orders'),
    )
    expect(sentKeys).toHaveLength(2)
    expect(sentKeys[1]).toBe(sentKeys[0])
    expect(created()).toHaveLength(1)
  })

  test('失败后修改了表单再提交：使用新的幂等键', async () => {
    interceptNext = (config) =>
      Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
    const form = openForm()
    await fillZhou(form)
    await userEvent.click(submitButton())
    await waitFor(() =>
      expect(submitButton()).not.toHaveClass('ant-btn-loading'),
    )

    await fill(form.years(), '3') // 会员改为办 3 年卡
    await userEvent.click(submitButton())
    await waitFor(() =>
      expect(form.router.state.location.pathname).toBe('/orders'),
    )
    expect(sentKeys[1]).not.toBe(sentKeys[0])
    expect(created()).toEqual([expect.objectContaining({ cardYears: 3 })])
  })
})

describe('未保存内容离开提示', () => {
  afterEach(() => Modal.destroyAll())

  const path = (form) => form.router.state.location.pathname
  const leaveDialog = () =>
    screen.queryByRole('dialog', { name: '离开此页面？' })
  // 顶栏的退出按钮（确认弹窗中也有同名按钮）
  const headerLogout = () =>
    within(document.querySelector('.ant-layout-header')).getByRole('button', {
      name: /退出登录/,
    })
  const logoutDialog = () =>
    screen.findByRole('dialog', { name: '确定退出登录？' })
  const clickMenu = (label) =>
    userEvent.click(within(screen.getByRole('menu')).getByText(label))

  test('空白表单离开不提示', async () => {
    const form = openForm()
    await clickMenu('订单列表')
    await waitFor(() => expect(path(form)).toBe('/orders'))
    expect(leaveDialog()).toBeNull()
  })

  test('输入后又删除（与初始值相同）离开不提示', async () => {
    const form = openForm()
    await userEvent.type(form.name(), '周雨桐')
    await userEvent.clear(form.name())
    await clickMenu('订单列表')
    await waitFor(() => expect(path(form)).toBe('/orders'))
  })

  test('填写后点菜单：提示确认；选择继续编辑，留在本页且输入保留', async () => {
    const form = openForm()
    await userEvent.type(form.name(), '周雨桐')
    await fill(form.years(), '5')
    await clickMenu('订单列表')

    expect(await screen.findByRole('dialog', { name: '离开此页面？' }))
    await userEvent.click(screen.getByRole('button', { name: /继续编辑/ }))
    expect(path(form)).toBe('/orders/new')
    expect(form.name()).toHaveValue('周雨桐')
    expect(form.years()).toHaveValue('5')
  })

  test('填写后点取消按钮：确认离开后回到列表', async () => {
    const form = openForm()
    await userEvent.type(form.phone(), '13816527409')
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    await screen.findByRole('dialog', { name: '离开此页面？' })
    await userEvent.click(screen.getByRole('button', { name: /离\s*开/ }))
    await waitFor(() => expect(path(form)).toBe('/orders'))
  })

  test('浏览器后退同样提示', async () => {
    const form = openForm()
    await act(() => form.router.navigate('/orders?tab=expired'))
    await act(() => form.router.navigate('/orders/new'))
    await userEvent.type(form.name(), '周雨桐')
    await act(() => form.router.navigate(-1))
    expect(await screen.findByRole('dialog', { name: '离开此页面？' }))
    expect(path(form)).toBe('/orders/new')
  })

  test('刷新或关闭页面：有未保存内容时触发浏览器原生提示', async () => {
    const form = openForm()
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(unload()).toBe(false)
    await userEvent.type(form.name(), '周雨桐')
    await waitFor(() => expect(unload()).toBe(true))
  })

  test('提交成功跳转列表时不提示', async () => {
    const form = openForm()
    await fill(form.name(), '周雨桐')
    await fill(form.phone(), '13816527409')
    await fill(form.years(), '5')
    await userEvent.click(screen.getByRole('button', { name: /提交订单/ }))
    await waitFor(() => expect(path(form)).toBe('/orders'))
    expect(leaveDialog()).toBeNull()
  })

  test('主动退出登录：有未提交内容时先确认，选择继续编辑则保持登录', async () => {
    const form = openForm()
    await userEvent.type(form.name(), '周雨桐')
    await userEvent.click(headerLogout())

    const dialog = await logoutDialog()
    await userEvent.click(
      within(dialog).getByRole('button', { name: /继续编辑/ }),
    )
    expect(useAuthStore.getState().token).not.toBeNull()
    expect(path(form)).toBe('/orders/new')
    expect(form.name()).toHaveValue('周雨桐')
  })

  test('主动退出登录：确认后退出并回到登录页，不再弹出离开提示', async () => {
    const form = openForm()
    await userEvent.type(form.name(), '周雨桐')
    await userEvent.click(headerLogout())
    const dialog = await logoutDialog()
    await userEvent.click(
      within(dialog).getByRole('button', { name: /退出登录/ }),
    )

    await waitFor(() => expect(path(form)).toBe('/login'))
    expect(useAuthStore.getState().token).toBeNull()
    expect(leaveDialog()).toBeNull()
  })

  test('没有未保存内容时退出登录不提示', async () => {
    const form = openForm()
    await userEvent.click(headerLogout())
    await waitFor(() => expect(path(form)).toBe('/login'))
    expect(screen.queryByRole('dialog', { name: '确定退出登录？' })).toBeNull()
  })

  test('登录失效（401）：不被表单拦截，直接回到登录页', async () => {
    const form = openForm()
    await userEvent.type(form.name(), '周雨桐')
    // 本地保存的 token 被截断，下一次请求返回 401
    const { token } = useAuthStore.getState()
    useAuthStore.setState({ token: token.slice(0, 18) })
    await act(() => http.get('/operation-logs').catch(() => {}))

    await waitFor(() => expect(path(form)).toBe('/login'))
    expect(leaveDialog()).toBeNull()
  })
})

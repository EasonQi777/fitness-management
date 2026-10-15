import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router'
import { describe, expect, test } from 'vitest'
import { useOrderQuery } from './useOrderQuery'

function setup(url = '/orders') {
  let renders = 0
  const { result } = renderHook(
    () => {
      renders++
      const [query, setQuery] = useOrderQuery()
      const { search } = useLocation()
      return {
        query,
        setQuery,
        search,
        navigate: useNavigate(),
        navigationType: useNavigationType(),
      }
    },
    {
      wrapper: ({ children }) => (
        <StrictMode>
          <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
        </StrictMode>
      ),
    },
  )
  return { result, renders: () => renders }
}

describe('从 URL 读取', () => {
  test('默认条件', () => {
    const { result } = setup()
    expect(result.current.query).toMatchObject({
      tab: 'all',
      page: 1,
      pageSize: 10,
    })
    expect(result.current.search).toBe('')
  })

  test('刷新页面后恢复筛选与分页', () => {
    const { result } = setup('/orders?tab=expired&memberName=%E7%8E%8B&page=2')
    expect(result.current.query).toMatchObject({
      tab: 'expired',
      memberName: '王',
      page: 2,
    })
  })

  test('无效参数被替换为规范地址，且不会反复跳转', () => {
    const { result, renders } = setup(
      '/orders?tab=pending&page=last&pageSize=100&from=wecom',
    )
    expect(result.current.search).toBe('')
    expect(result.current.query).toMatchObject({ tab: 'all', page: 1 })
    // StrictMode 下每次渲染执行两次：初次渲染 + 规范化后一次渲染
    expect(renders()).toBeLessThanOrEqual(6)
  })

  test('规范化使用替换而非新增历史，后退不会回到无效地址', () => {
    const { result } = setup('/orders?page=last')
    expect(result.current.navigationType).toBe('REPLACE')
  })

  test('提交条件新增历史记录', () => {
    const { result } = setup('/orders')
    act(() => result.current.setQuery({ tab: 'expired' }))
    expect(result.current.navigationType).toBe('PUSH')
  })
})

describe('提交条件', () => {
  test('提交搜索：去空格写入 URL，回到第 1 页', () => {
    const { result } = setup('/orders?tab=in_progress&page=2')
    act(() => result.current.setQuery({ memberName: ' 袁 ', orderNo: '' }))
    expect(result.current.query).toMatchObject({
      tab: 'in_progress',
      memberName: '袁',
      page: 1,
    })
    expect(result.current.search).toBe(
      `?tab=in_progress&memberName=${encodeURIComponent('袁')}`,
    )
  })

  test.each([
    ['切换 Tab', { tab: 'expired' }],
    ['修改每页数量', { pageSize: 20 }],
    ['重置搜索', { orderNo: '', memberName: '' }],
  ])('%s 回到第 1 页', (_, patch) => {
    const { result } = setup('/orders?memberName=%E7%8E%8B&page=3')
    act(() => result.current.setQuery(patch))
    expect(result.current.query.page).toBe(1)
  })

  test('重置保留当前 Tab 和每页数量', () => {
    const { result } = setup(
      '/orders?tab=expired&memberName=%E7%8E%8B&page=2&pageSize=20',
    )
    act(() => result.current.setQuery({ orderNo: '', memberName: '' }))
    expect(result.current.query).toMatchObject({
      tab: 'expired',
      memberName: '',
      page: 1,
      pageSize: 20,
    })
  })

  test('翻页只改变页码', () => {
    const { result } = setup('/orders?tab=expired&pageSize=20')
    act(() => result.current.setQuery({ page: 2 }))
    expect(result.current.query).toMatchObject({
      tab: 'expired',
      page: 2,
      pageSize: 20,
    })
  })

  test('条件未变化时不新增历史记录', () => {
    const { result } = setup('/orders?tab=expired')
    let changed
    act(() => (changed = result.current.setQuery({ tab: 'expired' })))
    expect(changed).toBe(false)
    act(() => (changed = result.current.setQuery({ memberName: '  ' })))
    expect(changed).toBe(false)
  })
})

describe('浏览器前进后退', () => {
  test('后退、前进恢复对应条件', () => {
    const { result } = setup('/orders')
    act(() => result.current.setQuery({ tab: 'expired' }))
    act(() => result.current.setQuery({ page: 2 }))
    expect(result.current.query).toMatchObject({ tab: 'expired', page: 2 })

    act(() => result.current.navigate(-1))
    expect(result.current.query).toMatchObject({ tab: 'expired', page: 1 })
    act(() => result.current.navigate(-1))
    expect(result.current.query).toMatchObject({ tab: 'all', page: 1 })
    act(() => result.current.navigate(1))
    expect(result.current.query).toMatchObject({ tab: 'expired', page: 1 })
  })
})

import { describe, expect, test } from 'vitest'
import { DEFAULT_QUERY, parseQuery, toSearchParams } from './orderQuery'

const parse = (search) => parseQuery(new URLSearchParams(search))

describe('parseQuery', () => {
  test('无参数时为默认条件', () => {
    expect(parse('')).toEqual({
      tab: 'all',
      orderNo: '',
      memberName: '',
      page: 1,
      pageSize: 10,
    })
  })

  test('收藏的“已到期第 2 页、每页 20 条”链接', () => {
    expect(parse('tab=expired&page=2&pageSize=20')).toEqual({
      ...DEFAULT_QUERY,
      tab: 'expired',
      page: 2,
      pageSize: 20,
    })
  })

  test('中文姓名与订单号', () => {
    expect(parse('memberName=%E8%A2%81&orderNo=FM20261009002')).toMatchObject({
      memberName: '袁',
      orderNo: 'FM20261009002',
    })
  })

  test.each([
    ['旧版本链接中已不存在的分组', 'tab=pending', { tab: 'all' }],
    ['手动改成 0 页', 'page=0', { page: 1 }],
    ['手动改成负数页', 'page=-3', { page: 1 }],
    ['手动改成文字', 'page=last', { page: 1 }],
    ['小数页码', 'page=2.5', { page: 1 }],
    ['不支持的每页数量', 'pageSize=100', { pageSize: 10 }],
    ['每页数量不是数字', 'pageSize=all', { pageSize: 10 }],
    ['搜索词前后有空格', 'memberName=%20%E8%A2%81%20', { memberName: '袁' }],
  ])('%s：归一化为默认值', (_, search, expected) => {
    expect(parse(search)).toMatchObject(expected)
  })
})

describe('toSearchParams', () => {
  test('默认条件序列化为空', () => {
    expect(toSearchParams(DEFAULT_QUERY).toString()).toBe('')
  })

  test('省略默认值，键顺序固定', () => {
    const params = toSearchParams({
      ...DEFAULT_QUERY,
      pageSize: 20,
      memberName: '袁',
      tab: 'in_progress',
    })
    expect([...params.keys()]).toEqual(['tab', 'memberName', 'pageSize'])
  })

  test('解析后再序列化保持不变（规范写法唯一）', () => {
    const search = 'tab=expired&memberName=%E7%8E%8B&page=3&pageSize=50'
    expect(toSearchParams(parse(search)).toString()).toBe(search)
  })

  test('无效值与多余参数被去掉', () => {
    expect(
      toSearchParams(parse('tab=pending&page=last&from=wecom')).toString(),
    ).toBe('')
  })
})

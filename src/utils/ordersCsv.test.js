import axios from 'axios'
import { beforeEach, describe, expect, test } from 'vitest'
import { createMockAdapter } from '../mock/adapter'
import { resetMockDb } from '../mock/db'
import { parseCsv } from '../test/csv'
import { FRONT_DESK, tokenFor } from '../test/fixtures'
import { buildOrdersCsv, ordersCsvFileName } from './ordersCsv'

const HEADER = [
  '订单号',
  '会员姓名',
  '购卡年限',
  '订单金额',
  '状态',
  '创建时间',
]

// 与导出预览返回的结构一致
const order = (memberName, extra = {}) => ({
  id: 'o-010',
  orderNo: 'FM20251108001',
  memberName,
  cardYears: 1,
  amount: 1200,
  status: 'completed',
  createdAt: '2025-11-08T08:20:00.000Z',
  ...extra,
})
const parsedNames = (csv) =>
  parseCsv(csv.slice(1))
    .slice(1)
    .map((r) => r[1])

describe('演示数据导出', () => {
  beforeEach(() => resetMockDb())

  async function exportAll() {
    const client = axios.create({
      baseURL: '/api',
      adapter: createMockAdapter({ delay: 0 }),
      headers: { Authorization: `Bearer ${tokenFor(FRONT_DESK)}` },
    })
    const { data } = await client.post('/orders/export-preview', {
      scope: 'filtered',
      filters: { tab: 'all' },
    })
    return buildOrdersCsv(data.items)
  }

  test('UTF-8 BOM 开头、CRLF 换行、固定中文表头', async () => {
    const csv = await exportAll()
    expect(csv.startsWith('\uFEFF"订单号","会员姓名"')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    expect(parseCsv(csv.slice(1))[0]).toEqual(HEADER)
  })

  test('12 笔可导出订单各一行，六列，金额与时间按约定格式', async () => {
    const rows = parseCsv((await exportAll()).slice(1))
    expect(rows).toHaveLength(13)
    expect(rows.every((r) => r.length === 6)).toBe(true)
    const byName = Object.fromEntries(rows.map((r) => [r[1], r]))
    expect(byName['孙浩']).toEqual([
      'FM20260630001',
      '孙浩',
      '10',
      '12,000.00',
      '已完成',
      '2026-06-30 21:10:52',
    ])
    expect(byName['吴佳琪'][3]).toBe('0.00') // 店庆赠送
    expect(byName['刘婷'][3]).toBe('') // 旧系统迁移，金额缺失
    expect(byName['欧阳晓峰'][4]).toBe('已到期')
  })

  test('不包含手机号与备注', async () => {
    const csv = await exportAll()
    expect(csv).not.toContain('15021876643') // David Miller 的手机号
    expect(csv).not.toContain('外籍会员，使用护照办理')
    expect(csv).not.toContain('旧系统迁移')
  })
})

describe('特殊字符不破坏表格结构', () => {
  test.each([
    ['护照姓名带逗号', 'MILLER, DAVID'],
    ['英文昵称带双引号', 'Kevin "KK" Zhang'],
    ['旧系统迁移时姓名混入换行', '陈\n志强'],
    ['同时含逗号、引号和换行', '"阿杰", 林\r\n俊杰'],
  ])('%s：仍为六列，姓名原样读回', (_, name) => {
    const csv = buildOrdersCsv([order(name)])
    const rows = parseCsv(csv.slice(1))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveLength(6)
    expect(rows[1][1]).toBe(name)
  })

  test('双引号在文件中加倍转义', () => {
    expect(buildOrdersCsv([order('Kevin "KK" Zhang')])).toContain(
      '"Kevin ""KK"" Zhang"',
    )
  })
})

describe('防止表格公式注入', () => {
  test.each([
    ['DDE 命令', "=cmd|' /C calc'!A0"],
    ['求和公式', '@SUM(A1:A9)'],
    ['加号开头', '+86 张伟'],
    ['微信昵称减号开头', '-小雨-'],
    ['从表格粘贴带入的制表符', '\t王芳'],
  ])('%s：前加单引号按文本显示', (_, name) => {
    const [read] = parsedNames(buildOrdersCsv([order(name)]))
    expect(read).toBe(`'${name}`)
  })

  test('普通姓名与订单号不加单引号', () => {
    const rows = parseCsv(buildOrdersCsv([order('张伟')]).slice(1))
    expect(rows[1].slice(0, 2)).toEqual(['FM20251108001', '张伟'])
  })
})

test('没有订单时只有表头', () => {
  expect(parseCsv(buildOrdersCsv([]).slice(1))).toEqual([HEADER])
})

test('文件名包含导出范围与上海时间', () => {
  const at = new Date('2026-10-15T07:42:08Z') // 上海 15:42:08
  expect(ordersCsvFileName('filtered', at)).toBe(
    '订单导出_筛选结果_20261015-154208.csv',
  )
  expect(ordersCsvFileName('selected', at)).toBe(
    '订单导出_勾选记录_20261015-154208.csv',
  )
})

test('跨零点按上海日期命名', () => {
  expect(ordersCsvFileName('filtered', new Date('2026-10-15T16:05:00Z'))).toBe(
    '订单导出_筛选结果_20261016-000500.csv',
  )
})

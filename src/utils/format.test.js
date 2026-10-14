import { describe, expect, test } from 'vitest'
import { formatAmount, formatDateTime } from './format'

describe('formatAmount', () => {
  test.each([
    ['十年卡', 12000, '12,000.00'],
    ['一年卡', 1200, '1,200.00'],
    ['12 笔订单续卡 10 年的总额', 115200, '115,200.00'],
    ['活动赠送卡', 0, '0.00'],
    ['续卡 5 年（八折）', 4800, '4,800.00'],
  ])('%s：%s → %s', (_, amount, text) =>
    expect(formatAmount(amount)).toBe(text),
  )

  test.each([
    ['历史数据缺失', null],
    ['字段未返回', undefined],
    ['计算异常', NaN],
    ['接口返回成字符串', '12000'],
  ])('%s（%j）→ —', (_, amount) => expect(formatAmount(amount)).toBe('—'))

  test('零金额与空金额不混淆', () => {
    expect(formatAmount(0)).not.toBe(formatAmount(null))
  })
})

describe('formatDateTime', () => {
  test.each([
    ['2026-01-01T00:00:00Z', '2026-01-01 08:00:00'],
    ['2026-01-01T08:00:00+08:00', '2026-01-01 08:00:00'],
    ['2025-12-31T16:30:05.123Z', '2026-01-01 00:30:05'], // 跨日
    ['2026-07-01T12:00:00-05:00', '2026-07-02 01:00:00'], // 其他时区
  ])('%s → %s（上海时区）', (iso, text) =>
    expect(formatDateTime(iso)).toBe(text),
  )

  test.each([null, undefined, '', 'not-a-date'])('%j → —', (v) =>
    expect(formatDateTime(v)).toBe('—'),
  )
})

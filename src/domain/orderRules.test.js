import { describe, expect, test } from 'vitest'
import {
  calcNewPrice,
  calcRenewPrice,
  calcRenewTotal,
  isValidYears,
  validateMemberName,
  validateOrderInput,
  validatePhone,
  validateRemark,
  validateYears,
} from './orderRules'

const INVALID_YEARS = [undefined, null, '', 0, 11, 1.5, -1, '5', NaN]

describe('年限', () => {
  test.each([1, 5, 10])('%s 年有效', (y) => expect(isValidYears(y)).toBe(true))
  test.each(INVALID_YEARS)('%j 无效', (y) =>
    expect(isValidYears(y)).toBe(false),
  )
})

describe('新建费用', () => {
  test.each([
    [1, 1200],
    [5, 6000],
    [10, 12000],
  ])('%s 年 = %s 元，不打折', (y, price) => expect(calcNewPrice(y)).toBe(price))

  test.each(INVALID_YEARS)('无效年限 %j 返回 null', (y) =>
    expect(calcNewPrice(y)).toBeNull(),
  )
})

describe('续卡费用', () => {
  test.each([
    [1, 1200],
    [4, 4800],
    [5, 4800],
    [6, 5760],
    [9, 8640],
    [10, 9600],
  ])('续卡 %s 年 = %s 元', (y, price) => expect(calcRenewPrice(y)).toBe(price))

  test('结果均为整数（无浮点误差）', () => {
    for (let y = 1; y <= 10; y++)
      expect(Number.isInteger(calcRenewPrice(y))).toBe(true)
  })

  test.each(INVALID_YEARS)('无效年限 %j 返回 null', (y) =>
    expect(calcRenewPrice(y)).toBeNull(),
  )

  test('三笔订单续卡 5 年，总价 14400 元', () => {
    expect(calcRenewTotal(5, 3)).toBe(14400)
  })

  test('无效年限的总价为 null', () => {
    expect(calcRenewTotal(0, 3)).toBeNull()
  })
})

describe('会员姓名', () => {
  test.each(['张三', '  张三  ', 'a'.repeat(30), ` ${'a'.repeat(30)} `])(
    '接受 %j',
    (v) => expect(validateMemberName(v)).toBeNull(),
  )

  test.each(['张', ' 张 ', 'a'.repeat(31)])('长度不符 %j', (v) =>
    expect(validateMemberName(v)).toBe('会员姓名需为 2–30 个字符'),
  )

  test.each([undefined, null, '', '   ', 123])('缺失 %j', (v) =>
    expect(validateMemberName(v)).toBe('请输入会员姓名'),
  )

  test('按 Unicode 字符计数：30 个 emoji 可接受，31 个拒绝', () => {
    expect(validateMemberName('😀'.repeat(30))).toBeNull()
    expect(validateMemberName('😀'.repeat(31))).not.toBeNull()
  })
})

describe('手机号', () => {
  test.each(['13800138000', '19912345678'])('接受 %s', (v) =>
    expect(validatePhone(v)).toBeNull(),
  )

  test.each([
    '12800138000', // 第二位不在 3–9
    '1380013800', // 10 位
    '138001380000', // 12 位
    ' 13800138000', // 含空格
    '1380013800a',
    13800138000, // 非字符串
  ])('拒绝 %j', (v) =>
    expect(validatePhone(v)).toBe('请输入正确的 11 位手机号'),
  )

  test.each([undefined, null, ''])('缺失 %j', (v) =>
    expect(validatePhone(v)).toBe('请输入手机号'),
  )
})

describe('购卡年限字段', () => {
  test.each([undefined, null, ''])('缺失 %j', (v) =>
    expect(validateYears(v)).toBe('请输入购卡年限'),
  )
  test.each([0, 11, 1.5, '5'])('拒绝 %j', (v) =>
    expect(validateYears(v)).toBe('年限需为 1–10 的整数'),
  )
  test.each([1, 10])('接受 %s', (v) => expect(validateYears(v)).toBeNull())
})

describe('备注', () => {
  test.each([undefined, null, '', 'a'.repeat(200), '😀'.repeat(200)])(
    '接受 %j',
    (v) => expect(validateRemark(v)).toBeNull(),
  )
  test('201 字拒绝', () =>
    expect(validateRemark('a'.repeat(201))).toBe('备注最多 200 字'))
  test('非字符串拒绝', () => expect(validateRemark(123)).toBe('备注格式不正确'))
})

describe('整单验证', () => {
  test('合法输入返回空对象', () => {
    expect(
      validateOrderInput({
        memberName: '张三',
        phone: '13800138000',
        cardYears: 3,
      }),
    ).toEqual({})
  })

  test('返回所有出错字段', () => {
    expect(
      validateOrderInput({
        memberName: '张',
        phone: '123',
        cardYears: 0,
        remark: 'a'.repeat(201),
      }),
    ).toEqual({
      memberName: '会员姓名需为 2–30 个字符',
      phone: '请输入正确的 11 位手机号',
      cardYears: '年限需为 1–10 的整数',
      remark: '备注最多 200 字',
    })
  })

  test('无参数时报告必填字段', () => {
    expect(Object.keys(validateOrderInput())).toEqual([
      'memberName',
      'phone',
      'cardYears',
    ])
  })
})

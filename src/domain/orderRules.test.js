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

// 表单或接口可能传来的无效年限：未填写、0、超出上限、小数、负数、未转换类型的字符串
const INVALID_YEARS = [undefined, null, '', 0, 11, 1.5, -1, '5', NaN]

// 30 / 31 个字符的外籍会员姓名
const NAME_30 = 'Maximilian Alexander Robertson'
const NAME_31 = 'Maximilian Alexander Richardson'

// 生僻字 𠮷 位于基本平面之外，JS 字符串 length 为 2，但只算 1 个字符
const RARE_CHAR = '𠮷'

// 前台常见的长备注
const NOTE =
  '会员要求周末到店领取会员卡，需开具公司抬头发票，抬头与税号已登记在会员资料中；如需改期请提前一天电话联系前台。'
const remarkOf = (length) => NOTE.repeat(5).slice(0, length)

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
  test.each([
    ['常见姓名', '张伟'],
    ['粘贴时带入首尾空格', '  张伟  '],
    ['带间隔号的少数民族姓名', '阿依古丽·买买提'],
    ['30 个字符的外籍姓名', NAME_30],
    ['首尾带空格的 30 个字符姓名', ` ${NAME_30} `],
  ])('接受%s', (_, v) => expect(validateMemberName(v)).toBeNull())

  test.each([
    ['只填了姓', '张'],
    ['只填了姓且带空格', ' 张 '],
    ['31 个字符的外籍姓名', NAME_31],
  ])('长度不符：%s', (_, v) =>
    expect(validateMemberName(v)).toBe('会员姓名需为 2–30 个字符'),
  )

  test.each([
    ['未填写', undefined],
    ['为 null', null],
    ['空字符串', ''],
    ['只有空格', '   '],
    ['误传成会员编号', 10023],
  ])('缺失：%s', (_, v) => expect(validateMemberName(v)).toBe('请输入会员姓名'))

  test('按 Unicode 字符计数：只填生僻字姓氏 𠮷 算 1 个字符，应拒绝', () => {
    expect(RARE_CHAR.length).toBe(2) // 按 length 判断会被误放行
    expect(validateMemberName(RARE_CHAR)).toBe('会员姓名需为 2–30 个字符')
    expect(validateMemberName(`${RARE_CHAR}田`)).toBeNull()
  })
})

describe('手机号', () => {
  test.each(['13916582047', '19921485360', '17758210394'])('接受 %s', (v) =>
    expect(validatePhone(v)).toBeNull(),
  )

  test.each([
    ['第二位输错', '12916582047'],
    ['少输一位', '1391658204'],
    ['多输一位', '139165820471'],
    ['粘贴时带入空格', ' 13916582047'],
    ['带分隔符', '139-1658-2047'],
    ['带国际区号', '+8613916582047'],
    ['填成座机号', '021-64381234'],
    ['接口传成数字', 13916582047],
  ])('拒绝：%s', (_, v) =>
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
  test.each([
    ['未填写', undefined],
    ['为 null', null],
    ['空字符串', ''],
    ['200 字', remarkOf(200)],
    ['含生僻字的 200 字（length 为 201）', remarkOf(199) + RARE_CHAR],
  ])('接受：%s', (_, v) => expect(validateRemark(v)).toBeNull())

  test('201 字拒绝', () =>
    expect(validateRemark(remarkOf(201))).toBe('备注最多 200 字'))

  test('非字符串拒绝（如接口传成数字）', () =>
    expect(validateRemark(2026)).toBe('备注格式不正确'))
})

describe('整单验证', () => {
  test('合法输入返回空对象', () => {
    expect(
      validateOrderInput({
        memberName: '张伟',
        phone: '13916582047',
        cardYears: 3,
        remark: '朋友推荐',
      }),
    ).toEqual({})
  })

  test('返回所有出错字段', () => {
    expect(
      validateOrderInput({
        memberName: '张',
        phone: '1391658204',
        cardYears: 0,
        remark: remarkOf(201),
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

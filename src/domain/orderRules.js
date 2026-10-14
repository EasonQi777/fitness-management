// 价格计算与订单表单验证。页面表单与模拟服务共用此文件。

/**
 * @typedef {Object} Order
 * @property {string} id 唯一 ID，由模拟服务生成
 * @property {string} orderNo 唯一订单号，由模拟服务生成
 * @property {string} memberName 会员姓名（已去首尾空格，2–30 字符）
 * @property {string} phone 中国大陆 11 位手机号
 * @property {number} cardYears 累计购卡年限，可超过 10
 * @property {number|null} amount 订单金额，整数元；可能为空
 * @property {keyof typeof import('./orderStatus').ORDER_STATUS} status 订单状态
 * @property {string} createdAt 创建时间，带时区的 ISO 字符串
 * @property {string} remark 备注，最多 200 字，可为空字符串
 * @property {number} version 版本号，新建为 1，每次成功修改加 1
 */

export const PRICE_PER_YEAR = 1200
export const MIN_YEARS = 1
export const MAX_YEARS = 10
const RENEW_DISCOUNT_YEARS = 5

const PHONE_PATTERN = /^1[3-9]\d{9}$/

// 按 Unicode 字符计数，emoji 或生僻字算 1 个字符
const charCount = (s) => [...s].length

/** 单次购卡 / 续卡年限：1–10 的整数 */
export const isValidYears = (years) =>
  Number.isInteger(years) && years >= MIN_YEARS && years <= MAX_YEARS

/** 新建费用 = 年限 × 1200，不打折；年限无效时返回 null */
export const calcNewPrice = (years) =>
  isValidYears(years) ? years * PRICE_PER_YEAR : null

/** 续卡单笔费用：本次续卡 ≥ 5 年打八折；年限无效时返回 null */
export const calcRenewPrice = (years) => {
  if (!isValidYears(years)) return null
  const base = years * PRICE_PER_YEAR
  // 整数运算，避免 0.8 的浮点误差
  return years >= RENEW_DISCOUNT_YEARS ? (base * 8) / 10 : base
}

/** 批量续卡总额 = 单笔费用 × 订单数 */
export const calcRenewTotal = (years, count) => {
  const price = calcRenewPrice(years)
  return price === null ? null : price * count
}

const isBlank = (v) => v === undefined || v === null || v === ''

// 以下验证函数：通过返回 null，否则返回中文错误信息

export function validateMemberName(value) {
  if (typeof value !== 'string' || value.trim() === '') return '请输入会员姓名'
  const n = charCount(value.trim())
  return n < 2 || n > 30 ? '会员姓名需为 2–30 个字符' : null
}

export function validatePhone(value) {
  if (isBlank(value)) return '请输入手机号'
  return typeof value === 'string' && PHONE_PATTERN.test(value)
    ? null
    : '请输入正确的 11 位手机号'
}

export function validateYears(value) {
  if (isBlank(value)) return '请输入购卡年限'
  return isValidYears(value) ? null : '年限需为 1–10 的整数'
}

export function validateRemark(value) {
  if (isBlank(value)) return null
  if (typeof value !== 'string') return '备注格式不正确'
  return charCount(value) > 200 ? '备注最多 200 字' : null
}

/**
 * 验证新建订单输入，返回 { 字段名: 错误信息 }；全部通过时返回空对象
 * @param {{ memberName?: unknown, phone?: unknown, cardYears?: unknown, remark?: unknown }} input
 */
export function validateOrderInput(input = {}) {
  const errors = {
    memberName: validateMemberName(input.memberName),
    phone: validatePhone(input.phone),
    cardYears: validateYears(input.cardYears),
    remark: validateRemark(input.remark),
  }
  return Object.fromEntries(Object.entries(errors).filter(([, msg]) => msg))
}

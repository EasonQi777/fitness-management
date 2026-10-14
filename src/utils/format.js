import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export const DISPLAY_TIMEZONE = 'Asia/Shanghai'
export const EMPTY_TEXT = '—'

const amountFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 金额：12000 → "12,000.00"，0 → "0.00"，空值 → "—" */
export const formatAmount = (amount) =>
  Number.isFinite(amount) ? amountFormat.format(amount) : EMPTY_TEXT

/** 时间：ISO 字符串按上海时区显示为 "YYYY-MM-DD HH:mm:ss"，无效值 → "—" */
export function formatDateTime(value) {
  if (!value) return EMPTY_TEXT
  const d = dayjs(value)
  return d.isValid()
    ? d.tz(DISPLAY_TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
    : EMPTY_TEXT
}

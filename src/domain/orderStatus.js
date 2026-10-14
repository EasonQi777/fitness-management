// 订单状态、筛选分组与操作资格。页面展示与模拟服务校验共用此文件。

/** 六种订单状态的中文名与 antd Tag 颜色 */
export const ORDER_STATUS = Object.freeze({
  pending_review: { label: '待审核', color: 'orange' },
  pending_card: { label: '待制卡', color: 'blue' },
  pending_shipping: { label: '待寄卡', color: 'cyan' },
  completed: { label: '已完成', color: 'green' },
  expired: { label: '已到期', color: 'red' },
  cancelled: { label: '已取消', color: 'default' },
})

/** 列表 Tab：key 用于 URL 与接口参数，statuses 为空表示不过滤 */
export const ORDER_TABS = Object.freeze([
  { key: 'all', label: '全部', statuses: [] },
  {
    key: 'in_progress',
    label: '进行中',
    statuses: ['pending_review', 'pending_card', 'pending_shipping'],
  },
  { key: 'expired', label: '已到期', statuses: ['expired'] },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'cancelled', label: '已取消', statuses: ['cancelled'] },
])

const RENEWABLE = new Set(['expired'])
const CANCELLABLE = new Set(['pending_card', 'pending_shipping'])
const EXPORTABLE = new Set(['completed', 'expired'])

// 使用 Set 判断，未知状态（包括 'constructor' 等原型属性名）一律不允许
export const canRenew = (status) => RENEWABLE.has(status)
export const canCancel = (status) => CANCELLABLE.has(status)
export const canExport = (status) => EXPORTABLE.has(status)

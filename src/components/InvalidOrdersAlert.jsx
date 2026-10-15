import { Alert } from 'antd'

/**
 * 批量操作被接口拒绝时，列出不合格订单及原因（续卡、撤单弹窗共用）
 * @param {{ error: { message: string, invalidOrders: import('../api/errors').InvalidOrder[] } | null }} props
 */
export default function InvalidOrdersAlert({ error }) {
  if (!error) return null
  return (
    <Alert
      type="error"
      showIcon
      className="mt-4"
      message={error.message}
      description={
        <ul className="m-0 pl-5">
          {error.invalidOrders.map((o) => (
            <li key={o.id}>
              {o.orderNo ?? o.id}：{o.reason}
            </li>
          ))}
        </ul>
      }
    />
  )
}

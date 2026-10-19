import { message, Modal, Table, Tag } from 'antd'
import { useRef, useState } from 'react'
import { parseApiError } from '../api/errors'
import { cancelOrders } from '../api/orders'
import { ORDER_STATUS } from '../domain/orderStatus'
import InvalidOrdersAlert from './InvalidOrdersAlert'
import { useRestoreFocus } from '../hooks/useRestoreFocus'

const columns = [
  { title: '订单号', dataIndex: 'orderNo', width: 140 },
  { title: '会员姓名', dataIndex: 'memberName' },
  {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    render: (status) => {
      const meta = ORDER_STATUS[status]
      return <Tag color={meta?.color}>{meta?.label ?? status}</Tag>
    },
  },
]

/**
 * 批量撤单二次确认：列出全部将撤单的订单（含其他分页），确认后整批提交。
 * 由父组件在打开时挂载、关闭时卸载。失败时弹窗保持打开并列出不合格订单；提交中不可关闭或重复确认。
 * @param {{
 *   orders: { id: string, orderNo: string, memberName: string, status: string, version: number }[],
 *   onCancel: () => void,
 *   onSuccess: (result: Awaited<ReturnType<typeof cancelOrders>>) => void,
 * }} props
 */
export default function CancelOrdersModal({ orders, onCancel, onSuccess }) {
  useRestoreFocus()
  const [submitting, setSubmitting] = useState(false)
  const [batchError, setBatchError] = useState(null)
  // 同步锁挡住连点；本次打开的订单固定，重试复用同一个幂等键
  const lockRef = useRef(false)
  const keyRef = useRef(crypto.randomUUID())

  async function submit() {
    if (lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    setBatchError(null)
    try {
      const result = await cancelOrders(
        { orders: orders.map(({ id, version }) => ({ id, version })) },
        { idempotencyKey: keyRef.current },
      )
      message.success(`已撤销 ${result.orders.length} 笔订单`)
      onSuccess(result)
    } catch (err) {
      const e = parseApiError(err)
      if (e.kind === 'batch') setBatchError(e)
      // general 已由请求层提示；unauthorized 由统一退出流程卸载页面
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title={`确认撤销以下 ${orders.length} 笔订单？`}
      okText="确认撤单"
      okButtonProps={{ danger: true, loading: submitting }}
      cancelText="再想想"
      cancelButtonProps={{ disabled: submitting }}
      onOk={submit}
      onCancel={onCancel}
      closable={!submitting}
      maskClosable={false}
      keyboard={!submitting}
    >
      <p>撤单后订单状态变为“已取消”，金额与年限保留，不能恢复。</p>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={orders}
        pagination={false}
        scroll={{ y: 280 }}
      />
      <InvalidOrdersAlert error={batchError} />
    </Modal>
  )
}

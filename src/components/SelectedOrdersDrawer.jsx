import { Button, Drawer, Empty, Table, Tag } from 'antd'
import { ORDER_STATUS } from '../domain/orderStatus'

/**
 * 查看已选订单：已选订单可能分布在不同分页和状态 Tab 中，在此统一核对、移除。
 * 状态为勾选时（或最近一次在列表中看到时）的状态，提交批量操作时以接口校验为准。
 */
export default function SelectedOrdersDrawer({
  open,
  onClose,
  orders,
  onRemove,
  onClear,
}) {
  const columns = [
    { title: '订单号', dataIndex: 'orderNo', width: 140 },
    { title: '会员姓名', dataIndex: 'memberName' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status) => {
        const meta = ORDER_STATUS[status]
        return meta ? (
          <Tag color={meta.color}>{meta.label}</Tag>
        ) : (
          <Tag>{status}</Tag>
        )
      },
    },
    {
      title: '操作',
      key: 'remove',
      width: 70,
      render: (_, order) => (
        <Button
          type="link"
          size="small"
          aria-label={`移除 ${order.orderNo}`}
          onClick={() => onRemove(order)}
        >
          移除
        </Button>
      ),
    },
  ]

  return (
    <Drawer
      title={`已选订单（${orders.length}）`}
      open={open}
      onClose={onClose}
      width={520}
      extra={
        <Button danger disabled={orders.length === 0} onClick={onClear}>
          清空全部
        </Button>
      }
    >
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={orders}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有勾选订单"
            />
          ),
        }}
      />
    </Drawer>
  )
}

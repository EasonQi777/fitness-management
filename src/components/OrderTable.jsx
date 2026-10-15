import { Button, Table, Tag, Typography } from 'antd'
import { canRenew, ORDER_STATUS } from '../domain/orderStatus'
import { formatAmount, formatDateTime } from '../utils/format'

function StatusTag({ status }) {
  const meta = ORDER_STATUS[status]
  // 未知状态原样显示编码，便于排查
  return meta ? <Tag color={meta.color}>{meta.label}</Tag> : <Tag>{status}</Tag>
}

function Amount({ value }) {
  if (value === null || value === undefined)
    return (
      <Typography.Text type="secondary" aria-label="金额缺失">
        {formatAmount(value)}
      </Typography.Text>
    )
  return formatAmount(value)
}

/**
 * 订单表格，只负责展示。
 * @param {{
 *   items: import('../domain/orderRules').Order[],
 *   loading?: boolean,
 *   onRenew?: (order: import('../domain/orderRules').Order) => void,
 * } & import('antd').TableProps} props 其余属性透传给 Table（分页、选择等）
 */
export default function OrderTable({ items, loading, onRenew, ...rest }) {
  const columns = [
    { title: '订单号', dataIndex: 'orderNo', width: 150 },
    { title: '会员姓名', dataIndex: 'memberName', width: 160 },
    {
      title: '购卡年限',
      dataIndex: 'cardYears',
      width: 100,
      align: 'right',
      render: (years) => `${years} 年`,
    },
    {
      title: '订单金额（元）',
      dataIndex: 'amount',
      width: 140,
      align: 'right',
      className: 'tabular-nums',
      render: (amount) => <Amount value={amount} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => <StatusTag status={status} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      className: 'tabular-nums',
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_, order) =>
        canRenew(order.status) && (
          <Button type="link" size="small" onClick={() => onRenew?.(order)}>
            续卡
          </Button>
        ),
    },
  ]

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      scroll={{ x: 920 }}
      {...rest}
    />
  )
}

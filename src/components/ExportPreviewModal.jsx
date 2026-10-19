import { Alert, Button, Empty, Modal, Spin, Table, Tag } from 'antd'
import { useEffect, useState } from 'react'
import { parseApiError } from '../api/errors'
import { exportPreview } from '../api/orders'
import { ORDER_STATUS } from '../domain/orderStatus'
import { formatAmount } from '../utils/format'
import { useRestoreFocus } from '../hooks/useRestoreFocus'

const columns = [
  { title: '订单号', dataIndex: 'orderNo', width: 140 },
  { title: '会员姓名', dataIndex: 'memberName' },
  {
    title: '状态',
    dataIndex: 'status',
    width: 80,
    render: (status) => {
      const meta = ORDER_STATUS[status]
      return <Tag color={meta?.color}>{meta?.label ?? status}</Tag>
    },
  },
  {
    title: '金额（元）',
    dataIndex: 'amount',
    width: 110,
    align: 'right',
    render: formatAmount,
  },
]

const TITLES = { filtered: '导出筛选结果', selected: '导出勾选记录' }

/**
 * 导出预览：打开时向服务端请求预览，列出可导出与被排除的订单；
 * 确认后把本次预览的快照交给 onConfirm 生成文件，不再重新读取数据。
 * 由父组件在打开时挂载、关闭时卸载；卸载时取消未完成的预览请求。
 * @param {{
 *   request: Parameters<typeof exportPreview>[0],
 *   onCancel: () => void,
 *   onConfirm: (snapshot: { scope: string } & Awaited<ReturnType<typeof exportPreview>>) => void,
 * }} props
 */
export default function ExportPreviewModal({ request, onCancel, onConfirm }) {
  useRestoreFocus()
  const [attempt, setAttempt] = useState(0)
  // { attempt, preview?, error? }：只采用当前这次请求的结果
  const [result, setResult] = useState(null)
  const loading = result?.attempt !== attempt
  const preview = loading ? null : result.preview
  const error = loading ? null : result.error

  useEffect(() => {
    const controller = new AbortController()
    exportPreview(request, { signal: controller.signal }).then(
      (preview) => setResult({ attempt, preview }),
      (err) => {
        const error = parseApiError(err)
        if (error.kind !== 'cancelled') setResult({ attempt, error })
      },
    )
    return () => controller.abort()
  }, [request, attempt])

  const count = preview?.items.length ?? 0

  return (
    <Modal
      open
      width={640}
      centered
      title={TITLES[request.scope]}
      okText={count ? `确认导出 ${count} 笔` : '确认导出'}
      okButtonProps={{ disabled: !count }}
      onOk={() => onConfirm({ scope: request.scope, ...preview })}
      onCancel={onCancel}
      maskClosable={false}
    >
      {loading && (
        <div className="py-10 text-center">
          <Spin tip="正在生成导出预览…">
            <div className="h-10" />
          </Spin>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message="导出预览加载失败"
          description={error.message}
          action={
            <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
              重试
            </Button>
          }
        />
      )}

      {preview && (
        <>
          <p aria-live="polite">
            可导出 <strong>{count}</strong> 笔，排除{' '}
            <strong>{preview.excluded.length}</strong>{' '}
            笔（仅“已完成”“已到期”订单可导出）
          </p>
          {count ? (
            <Table
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={preview.items}
              pagination={false}
              scroll={{ y: 200 }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="没有可导出的订单，不会生成文件"
            />
          )}
          {preview.excluded.length > 0 && (
            <Alert
              type="warning"
              className="mt-4"
              message={`以下 ${preview.excluded.length} 笔订单不会导出`}
              description={
                <ul className="m-0 max-h-28 overflow-y-auto pl-5">
                  {preview.excluded.map((o) => (
                    <li key={o.id}>
                      {o.orderNo ?? o.id}：{o.reason}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </>
      )}
    </Modal>
  )
}

import {
  Button,
  Empty,
  Form,
  Input,
  message,
  Result,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import CancelOrdersModal from '../components/CancelOrdersModal'
import ExportPreviewModal from '../components/ExportPreviewModal'
import OrderTable from '../components/OrderTable'
import RenewOrdersModal from '../components/RenewOrdersModal'
import SelectedOrdersDrawer from '../components/SelectedOrdersDrawer'
import { DEFAULT_QUERY, PAGE_SIZES } from '../domain/orderQuery'
import {
  canCancel,
  canRenew,
  ORDER_STATUS,
  ORDER_TABS,
} from '../domain/orderStatus'
import { useOrderQuery } from '../hooks/useOrderQuery'
import { useOrderSelection } from '../hooks/useOrderSelection'
import { useOrders } from '../hooks/useOrders'
import { downloadText } from '../utils/download'
import { buildOrdersCsv, ordersCsvFileName } from '../utils/ordersCsv'

const TAB_ITEMS = ORDER_TABS.map(({ key, label }) => ({ key, label }))

const summaryOf = (o) =>
  `${o.orderNo}（${o.memberName}，${ORDER_STATUS[o.status]?.label ?? o.status}）`

/**
 * 批量操作按钮：未勾选或勾选中有不合格订单时禁用，并说明原因、列出需移除的订单
 * @param {{ label: string, count: number, blocked: { orderNo: string, memberName: string, status: string }[],
 *   rule: string, blockedAs: string, onClick: () => void } & import('antd').ButtonProps} props
 */
function BatchButton({ label, count, blocked, rule, blockedAs, ...button }) {
  return (
    <>
      <Tooltip
        title={
          blocked.length > 0 &&
          `${rule}，请移除：${blocked.map(summaryOf).join('、')}`
        }
      >
        {/* 禁用的按钮不触发悬停，由外层 span 接收，提示才能显示 */}
        <span>
          <Button
            size="small"
            {...button}
            disabled={count === 0 || blocked.length > 0}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
      {blocked.length > 0 && (
        <Typography.Text type="warning">
          已选中有 {blocked.length} 笔{blockedAs}，不能{label}
        </Typography.Text>
      )}
    </>
  )
}

export default function OrdersPage() {
  const [query, setQuery] = useOrderQuery()
  const { items, total, loading, error, refresh } = useOrders(query)
  const [form] = Form.useForm()
  // 勾选跨页、跨 Tab、跨搜索保留，可在“查看已选”中核对
  const selection = useOrderSelection(items)
  const [viewingSelected, setViewingSelected] = useState(false)
  // 正在续卡的订单：{ orders, batch }，null 表示弹窗关闭
  const [renewing, setRenewing] = useState(null)
  // 待确认撤单的订单，null 表示弹窗关闭
  const [cancelling, setCancelling] = useState(null)
  // 导出预览请求，null 表示弹窗关闭；打开时固定，预览期间不会因页面变化而重新请求
  const [exporting, setExporting] = useState(null)
  // 最近一次写入成功：{ text, queryKey }。写后刷新失败时据此说明“操作已成功”，避免员工误以为失败而重复操作
  const [lastWrite, setLastWrite] = useState(null)
  const queryKey = JSON.stringify(query)

  // 写入后记录移出当前筛选、末页变空时（或链接中的页码过大），回到最后有效页；替换历史记录，后退不会回到空页
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize))
  useEffect(() => {
    if (!loading && !error && query.page > lastPage)
      setQuery({ page: lastPage }, { replace: true })
  }, [loading, error, query.page, lastPage, setQuery])

  // 本页最近一次提交的输入框内容。地址栏在提交后异步更新，期间员工可能已经输入了新的草稿
  const submittedRef = useRef(null)

  // 输入框是草稿；已提交条件变化（含浏览器前进后退）时用其回填。
  // 由本页提交引起的变化，若输入框已与提交时不同（提交后又继续输入），不覆盖新草稿
  useEffect(() => {
    const submitted = submittedRef.current
    submittedRef.current = null
    const current = form.getFieldsValue(['orderNo', 'memberName'])
    if (
      submitted &&
      ((current.orderNo ?? '') !== submitted.orderNo ||
        (current.memberName ?? '') !== submitted.memberName)
    )
      return
    form.setFieldsValue({
      orderNo: query.orderNo,
      memberName: query.memberName,
    })
  }, [form, query.orderNo, query.memberName])

  function search({ orderNo = '', memberName = '' }) {
    submittedRef.current = { orderNo, memberName }
    // 条件未变时（如重复点击查询）按原条件重新查询；地址栏不变，回填效果不会触发
    if (!setQuery({ orderNo, memberName })) {
      submittedRef.current = null
      refresh()
    }
  }

  function reset() {
    form.setFieldsValue({ orderNo: '', memberName: '' })
    submittedRef.current = { orderNo: '', memberName: '' }
    if (!setQuery({ orderNo: '', memberName: '' })) submittedRef.current = null
  }

  // 按勾选时的状态预检：含不合格订单时禁用对应批量操作；接口仍做最终校验
  const notRenewable = selection.selectedOrders.filter(
    (o) => !canRenew(o.status),
  )
  const notCancellable = selection.selectedOrders.filter(
    (o) => !canCancel(o.status),
  )

  function renewed({ orders }) {
    if (renewing.batch) selection.clear()
    setRenewing(null)
    setLastWrite({ text: `${orders.length} 笔订单续卡已成功`, queryKey })
    refresh()
  }

  function cancelled({ orders }) {
    selection.clear()
    setCancelling(null)
    setLastWrite({ text: `${orders.length} 笔订单撤单已成功`, queryKey })
    refresh()
  }

  /** 按确认的预览快照生成文件，不再重新读取数据；失败时保留预览，可再次确认 */
  function exportCsv({ scope, items }) {
    try {
      downloadText(
        ordersCsvFileName(scope),
        buildOrdersCsv(items),
        'text/csv;charset=utf-8',
      )
    } catch {
      message.error('导出文件生成失败，请重试')
      return
    }
    message.success(`已导出 ${items.length} 笔订单`)
    setExporting(null)
  }

  const refreshFailedAfterWrite = error && lastWrite?.queryKey === queryKey

  const filtered =
    query.tab !== DEFAULT_QUERY.tab || query.orderNo || query.memberName

  return (
    <section className="rounded-lg bg-white p-4">
      <h1 className="mt-0 mb-2 text-lg font-semibold">订单列表</h1>

      <Tabs
        activeKey={query.tab}
        items={TAB_ITEMS}
        onChange={(tab) => setQuery({ tab })}
      />

      <Form
        form={form}
        layout="inline"
        className="mb-4 gap-y-2"
        onFinish={search}
      >
        <Form.Item label="订单号" name="orderNo">
          <Input
            placeholder="完整订单号，如 FM20261009001"
            allowClear
            className="w-60"
          />
        </Form.Item>
        <Form.Item label="会员姓名" name="memberName">
          <Input placeholder="可输入部分姓名" allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
            <Button onClick={reset}>重置</Button>
            {/* 按已提交的条件（URL）导出全部分页，而不是输入框中的草稿 */}
            <Button
              onClick={() =>
                setExporting({
                  scope: 'filtered',
                  filters: {
                    tab: query.tab,
                    orderNo: query.orderNo,
                    memberName: query.memberName,
                  },
                })
              }
            >
              导出筛选结果
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span aria-live="polite">
          已选 <strong>{selection.count}</strong> 条（跨页、跨状态保留）
        </span>
        <Button
          size="small"
          disabled={selection.count === 0}
          onClick={() => setViewingSelected(true)}
        >
          查看已选
        </Button>
        <Button
          size="small"
          disabled={selection.count === 0}
          onClick={selection.clear}
        >
          清空选择
        </Button>
        <BatchButton
          label="批量续卡"
          type="primary"
          count={selection.count}
          blocked={notRenewable}
          rule="仅已到期订单可续卡"
          blockedAs="不是已到期订单"
          onClick={() =>
            setRenewing({ orders: selection.selectedOrders, batch: true })
          }
        />
        <BatchButton
          label="批量撤单"
          danger
          count={selection.count}
          blocked={notCancellable}
          rule="仅待制卡、待寄卡订单可撤单"
          blockedAs="不是待制卡或待寄卡订单"
          onClick={() => setCancelling(selection.selectedOrders)}
        />
        <Button
          size="small"
          disabled={selection.count === 0}
          onClick={() =>
            setExporting({ scope: 'selected', ids: selection.selectedIds })
          }
        >
          导出勾选记录
        </Button>
      </div>

      {exporting && (
        <ExportPreviewModal
          request={exporting}
          onCancel={() => setExporting(null)}
          onConfirm={exportCsv}
        />
      )}

      {cancelling && (
        <CancelOrdersModal
          orders={cancelling}
          onCancel={() => setCancelling(null)}
          onSuccess={cancelled}
        />
      )}

      {renewing && (
        <RenewOrdersModal
          orders={renewing.orders}
          onCancel={() => setRenewing(null)}
          onSuccess={renewed}
        />
      )}

      <SelectedOrdersDrawer
        open={viewingSelected}
        onClose={() => setViewingSelected(false)}
        orders={selection.selectedOrders}
        onRemove={(order) => selection.select([order], false)}
        onClear={selection.clear}
      />

      {error ? (
        // 失败时不展示旧数据；重试沿用已提交的条件（URL），而不是输入框中的草稿
        <div role="alert">
          <Result
            status={refreshFailedAfterWrite ? 'warning' : 'error'}
            title={
              refreshFailedAfterWrite
                ? `${lastWrite.text}，但订单列表刷新失败`
                : '订单加载失败'
            }
            subTitle={
              refreshFailedAfterWrite
                ? `${error.message}。点击“重新加载列表”只会重新查询，不会重复执行操作。`
                : error.message
            }
            extra={
              <Button type="primary" onClick={refresh}>
                {refreshFailedAfterWrite ? '重新加载列表' : '重试'}
              </Button>
            }
          />
        </div>
      ) : (
        <OrderTable
          items={items}
          onRenew={(order) => setRenewing({ orders: [order], batch: false })}
          rowSelection={{
            selectedRowKeys: selection.selectedIds,
            preserveSelectedRowKeys: true,
            onSelect: (order, checked) => selection.select([order], checked),
            // 表头全选只作用于当前页
            onSelectAll: (checked, _rows, changed) =>
              selection.select(changed, checked),
            columnTitle: (checkbox) => (
              <Tooltip title="全选当前页">{checkbox}</Tooltip>
            ),
          }}
          // 查询中表格被遮罩，行内操作不可点击
          loading={{ spinning: loading, tip: '查询中…' }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={filtered ? '没有符合条件的订单' : '暂无订单'}
              />
            ),
          }}
          pagination={{
            current: query.page,
            pageSize: query.pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZES,
            showTotal: (n) => `共 ${n} 条`,
            onChange: (page, pageSize) =>
              setQuery(pageSize === query.pageSize ? { page } : { pageSize }),
          }}
        />
      )}
    </section>
  )
}

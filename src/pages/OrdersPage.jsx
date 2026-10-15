import { Button, Empty, Form, Input, Result, Space, Tabs, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import OrderTable from '../components/OrderTable'
import SelectedOrdersDrawer from '../components/SelectedOrdersDrawer'
import { DEFAULT_QUERY, PAGE_SIZES } from '../domain/orderQuery'
import { ORDER_TABS } from '../domain/orderStatus'
import { useOrderQuery } from '../hooks/useOrderQuery'
import { useOrderSelection } from '../hooks/useOrderSelection'
import { useOrders } from '../hooks/useOrders'

const TAB_ITEMS = ORDER_TABS.map(({ key, label }) => ({ key, label }))

// 续卡弹窗在 T32 接入
export default function OrdersPage() {
  const [query, setQuery] = useOrderQuery()
  const { items, total, loading, error, refresh } = useOrders(query)
  const [form] = Form.useForm()
  // 勾选跨页、跨 Tab、跨搜索保留，可在“查看已选”中核对
  const selection = useOrderSelection(items)
  const [viewingSelected, setViewingSelected] = useState(false)

  // 输入框是草稿；已提交条件变化（含浏览器前进后退）时用其回填
  useEffect(() => {
    form.setFieldsValue({
      orderNo: query.orderNo,
      memberName: query.memberName,
    })
  }, [form, query.orderNo, query.memberName])

  function search({ orderNo = '', memberName = '' }) {
    // 条件未变时（如重复点击查询）按原条件重新查询
    if (!setQuery({ orderNo, memberName })) refresh()
  }

  function reset() {
    form.setFieldsValue({ orderNo: '', memberName: '' })
    setQuery({ orderNo: '', memberName: '' })
  }

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
      </div>

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
            status="error"
            title="订单加载失败"
            subTitle={error.message}
            extra={
              <Button type="primary" onClick={refresh}>
                重试
              </Button>
            }
          />
        </div>
      ) : (
        <OrderTable
          items={items}
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

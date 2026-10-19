import {
  Descriptions,
  Form,
  InputNumber,
  message,
  Modal,
  Typography,
} from 'antd'
import { useRef, useState } from 'react'
import { parseApiError } from '../api/errors'
import InvalidOrdersAlert from './InvalidOrdersAlert'
import { renewOrders } from '../api/orders'
import {
  calcRenewPrice,
  calcRenewTotal,
  isValidYears,
  PRICE_PER_YEAR,
} from '../domain/orderRules'
import { formatAmount } from '../utils/format'
import { useRestoreFocus } from '../hooks/useRestoreFocus'

const yearsRule = {
  validator: (_, v) => {
    if (v === undefined || v === null || v === '')
      return Promise.reject(new Error('请输入续卡年限'))
    return isValidYears(v)
      ? Promise.resolve()
      : Promise.reject(new Error('年限需为 1–10 的整数'))
  },
}

const yuan = (n) => `¥ ${formatAmount(n)}`
const INITIAL_YEARS = 1

function Fees({ years, count }) {
  const unit = calcRenewPrice(years)
  if (unit === null)
    return (
      <Typography.Text type="secondary">请先填写有效的续卡年限</Typography.Text>
    )
  const list = years * PRICE_PER_YEAR
  return (
    <Descriptions
      size="small"
      column={1}
      items={[
        {
          label: '单笔费用',
          children: (
            <span className="tabular-nums">
              {yuan(unit)}
              {unit < list && (
                <Typography.Text type="secondary" className="ml-2">
                  （原价 {yuan(list)}，已享八折）
                </Typography.Text>
              )}
            </span>
          ),
        },
        {
          label: '应付总额',
          children: (
            <Typography.Text strong className="text-base tabular-nums">
              {yuan(calcRenewTotal(years, count))}
              {count > 1 && (
                <Typography.Text type="secondary" className="ml-2">
                  （{count} 笔 × {yuan(unit)}）
                </Typography.Text>
              )}
            </Typography.Text>
          ),
        },
      ]}
    />
  )
}

/**
 * 续卡弹窗，单条与批量共用。由父组件在打开时挂载、关闭时卸载，每次打开都是全新状态。
 * 提交失败时弹窗保持打开，年限与不合格订单列表保留；提交中不可关闭或重复确认。
 * @param {{
 *   orders: { id: string, orderNo: string, memberName: string, version: number }[],
 *   onCancel: () => void,
 *   onSuccess: (result: Awaited<ReturnType<typeof renewOrders>>) => void,
 * }} props
 */
export default function RenewOrdersModal({ orders, onCancel, onSuccess }) {
  useRestoreFocus()
  const [form] = Form.useForm()
  // 表单挂载前 useWatch 为 undefined，先用初始值，避免打开时闪现“请先填写”；清空输入为 null
  const watched = Form.useWatch('years', form)
  const years = watched === undefined ? INITIAL_YEARS : watched
  const [submitting, setSubmitting] = useState(false)
  const [batchError, setBatchError] = useState(null)
  // 同步锁挡住回车与连点；同一次提交意图复用幂等键，修改年限后作废
  const lockRef = useRef(false)
  const keyRef = useRef(null)

  async function submit({ years }) {
    if (lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    setBatchError(null)
    keyRef.current ??= crypto.randomUUID()
    try {
      const result = await renewOrders(
        { orders: orders.map(({ id, version }) => ({ id, version })), years },
        { idempotencyKey: keyRef.current },
      )
      message.success(`已为 ${result.orders.length} 笔订单续卡 ${years} 年`)
      onSuccess(result)
    } catch (err) {
      const e = parseApiError(err)
      if (e.kind === 'field')
        form.setFields(
          Object.entries(e.fieldErrors).map(([name, msg]) => ({
            name,
            errors: [msg],
          })),
        )
      else if (e.kind === 'batch') setBatchError(e)
      // general 已由请求层提示；unauthorized 由统一退出流程卸载页面
      lockRef.current = false
      setSubmitting(false)
    }
  }

  const single = orders.length === 1 ? orders[0] : null

  return (
    <Modal
      open
      title="续卡"
      okText="确认续卡"
      onOk={() => form.submit()}
      onCancel={onCancel}
      okButtonProps={{ loading: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      closable={!submitting}
      maskClosable={false}
      keyboard={!submitting}
    >
      <p>
        {single
          ? `订单 ${single.orderNo}（${single.memberName}）`
          : `共 ${orders.length} 笔订单，每笔续卡相同年限`}
      </p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ years: INITIAL_YEARS }}
        disabled={submitting}
        onFinish={submit}
        onValuesChange={() => (keyRef.current = null)}
      >
        <Form.Item
          label="续卡年限"
          name="years"
          required
          extra="1–10 的整数；本次续卡满 5 年享八折"
          rules={[yearsRule]}
        >
          {/* 不设 min / max / precision：非法值应提示错误，而不是被自动改写 */}
          <InputNumber suffix="年" className="w-40" />
        </Form.Item>
      </Form>
      <div aria-live="polite" data-testid="renew-fees">
        <Fees years={years} count={orders.length} />
      </div>
      <InvalidOrdersAlert error={batchError} />
    </Modal>
  )
}

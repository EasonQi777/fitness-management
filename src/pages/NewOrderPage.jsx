import { Button, Form, Input, InputNumber, Space, Typography } from 'antd'
import { useNavigate } from 'react-router'
import {
  calcNewPrice,
  PRICE_PER_YEAR,
  validateMemberName,
  validatePhone,
  validateRemark,
  validateYears,
} from '../domain/orderRules'
import { formatAmount } from '../utils/format'

// 复用领域层的验证函数：页面提示与接口校验使用同一套规则
const ruleOf = (validate) => ({
  validator: (_, value) => {
    const message = validate(value)
    return message ? Promise.reject(new Error(message)) : Promise.resolve()
  },
})

const charCount = (text) => [...text].length

function Fee({ years }) {
  const price = calcNewPrice(years)
  if (price === null)
    return (
      <Typography.Text type="secondary">请先填写有效的购卡年限</Typography.Text>
    )
  return (
    <span>
      <Typography.Text strong className="text-base tabular-nums">
        ¥ {formatAmount(price)}
      </Typography.Text>
      <Typography.Text type="secondary" className="ml-2">
        （{years} 年 × {formatAmount(PRICE_PER_YEAR)} 元/年）
      </Typography.Text>
    </span>
  )
}

// 提交与结果处理在 T29 接入
export default function NewOrderPage() {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const years = Form.useWatch('cardYears', form)

  return (
    <section className="max-w-xl rounded-lg bg-white p-6">
      <h1 className="mt-0 mb-6 text-lg font-semibold">新建订单</h1>
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          label="会员姓名"
          name="memberName"
          required
          rules={[ruleOf(validateMemberName)]}
        >
          <Input placeholder="2–30 个字符" autoComplete="off" />
        </Form.Item>

        <Form.Item
          label="联系手机号"
          name="phone"
          required
          rules={[ruleOf(validatePhone)]}
        >
          <Input
            placeholder="11 位中国大陆手机号"
            inputMode="numeric"
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          label="购卡年限"
          name="cardYears"
          required
          extra="1–10 的整数"
          rules={[ruleOf(validateYears)]}
        >
          {/* 不设 min / max / precision：超出范围或小数应提示错误，而不是被自动改写 */}
          <InputNumber suffix="年" className="w-40" />
        </Form.Item>

        {/* 只读展示，不是表单字段，不会被提交 */}
        <Form.Item label="办卡费用">
          <div aria-live="polite" data-testid="fee">
            <Fee years={years} />
          </div>
        </Form.Item>

        <Form.Item label="备注" name="remark" rules={[ruleOf(validateRemark)]}>
          <Input.TextArea
            rows={3}
            placeholder="选填"
            count={{ show: true, max: 200, strategy: charCount }}
          />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit">
            提交订单
          </Button>
          <Button onClick={() => navigate('/orders')}>取消</Button>
        </Space>
      </Form>
    </section>
  )
}

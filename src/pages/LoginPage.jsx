import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useRef, useState } from 'react'
import { login } from '../api/auth'
import { parseApiError } from '../api/errors'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [form] = Form.useForm()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // 按钮 loading 无法阻止回车重复提交，用 ref 做同步锁
  const lockRef = useRef(false)

  async function handleFinish({ username, password }) {
    if (lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    setError('')
    try {
      // 成功后由 GuestOnly 守卫跳转到回跳地址，组件随之卸载
      setAuth(await login({ username, password }))
    } catch (err) {
      const e = parseApiError(err)
      if (e.kind === 'field') {
        form.setFields(
          Object.entries(e.fieldErrors).map(([name, msg]) => ({
            name,
            errors: [msg],
          })),
        )
      } else if (e.kind !== 'cancelled') {
        setError(e.message)
      }
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <Typography.Title level={3} className="text-center">
          健身房订单管理后台
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="text-center">
          演示环境：任意非空账号和密码均可登录
        </Typography.Paragraph>

        {error && (
          <Alert type="error" showIcon message={error} className="mb-4" />
        )}

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleFinish}
          disabled={submitting}
        >
          <Form.Item
            label="账号"
            name="username"
            rules={[
              { required: true, whitespace: true, message: '请输入账号' },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              autoComplete="username"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, whitespace: true, message: '请输入密码' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  )
}

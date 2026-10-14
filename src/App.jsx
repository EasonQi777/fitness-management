import { Card, Empty } from 'antd'

// 占位首页，T12 接入路由后替换
export default function App() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Card title="健身房会员办卡订单管理后台">
        <Empty description="功能建设中" />
      </Card>
    </main>
  )
}

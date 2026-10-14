import {
  LogoutOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Breadcrumb, Button, Layout, Menu } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useAuthStore } from '../store/authStore'
import { endSession } from '../store/session'

const MENU_ITEMS = [
  { key: '/orders', icon: <UnorderedListOutlined />, label: '订单列表' },
  { key: '/orders/new', icon: <PlusOutlined />, label: '新建订单' },
]

const BREADCRUMBS = {
  '/orders': ['订单管理', '订单列表'],
  '/orders/new': ['订单管理', '新建订单'],
}

export default function AdminLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const username = useAuthStore((s) => s.username)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Layout className="min-h-screen">
      {/* 小于 lg（992px）自动收起为图标菜单，可通过底部按钮展开 */}
      <Layout.Sider
        breakpoint="lg"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
      >
        <div className="flex h-16 items-center justify-center px-2 text-base font-semibold whitespace-nowrap text-white">
          {collapsed ? '订单' : '订单管理后台'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={MENU_ITEMS}
          selectedKeys={[pathname]}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>

      {/* min-w-0：让宽表格在内容区内横向滚动，而不是撑宽整个页面 */}
      <Layout className="min-w-0">
        <Layout.Header className="flex items-center justify-end gap-2 bg-white px-4">
          <span className="flex items-center gap-1 truncate">
            <UserOutlined />
            {username}
          </span>
          <Button
            type="link"
            icon={<LogoutOutlined />}
            onClick={() => endSession()}
          >
            退出登录
          </Button>
        </Layout.Header>
        <Layout.Content className="p-4">
          <Breadcrumb
            className="mb-4"
            items={(BREADCRUMBS[pathname] ?? []).map((title) => ({ title }))}
          />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}

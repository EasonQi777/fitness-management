import {
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Breadcrumb, Button, Grid, Layout, Menu, Modal } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useAuthStore } from '../store/authStore'
import { endSession } from '../store/session'
import { useUnsavedStore } from '../store/unsavedStore'

// 图标仅作装饰（aria-hidden），读屏只读中文名称，而不是图标的英文名
const MENU_ITEMS = [
  {
    key: '/orders',
    icon: <UnorderedListOutlined aria-hidden />,
    label: '订单列表',
  },
  { key: '/orders/new', icon: <PlusOutlined aria-hidden />, label: '新建订单' },
]

const BREADCRUMBS = {
  '/orders': ['订单管理', '订单列表'],
  '/orders/new': ['订单管理', '新建订单'],
}

export default function AdminLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const username = useAuthStore((s) => s.username)
  // 初始即按屏幕宽度决定，避免手机上先展开再收起的闪动（992px 与 Sider 的 lg 断点一致）
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia('(max-width: 991.98px)').matches,
  )
  // 小于 md（768px）的手机屏：菜单收起时完全隐藏，把宽度留给内容；选择菜单后自动收起
  const narrow = Grid.useBreakpoint().md === false
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  // 主动退出：有未保存的表单内容时先确认（401 失效不经过这里，直接退出）
  function logout() {
    if (useUnsavedStore.getState().dirty) setConfirmingLogout(true)
    else endSession()
  }

  return (
    <Layout className="min-h-screen">
      {/* 小于 lg（992px）自动收起：平板为图标菜单，手机完全隐藏；由顶栏按钮展开（键盘可用） */}
      <Layout.Sider
        id="side-menu"
        breakpoint="lg"
        collapsible
        trigger={null}
        collapsed={collapsed}
        collapsedWidth={narrow ? 0 : 80}
        onBreakpoint={setCollapsed}
      >
        <div className="flex h-16 items-center justify-center px-2 text-base font-semibold whitespace-nowrap text-white">
          {collapsed ? '订单' : '订单管理后台'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={MENU_ITEMS}
          selectedKeys={[pathname]}
          onClick={({ key }) => {
            navigate(key)
            if (narrow) setCollapsed(true)
          }}
        />
      </Layout.Sider>

      {/* min-w-0：让宽表格在内容区内横向滚动，而不是撑宽整个页面 */}
      <Layout className="min-w-0">
        <Layout.Header className="flex items-center gap-2 bg-white px-4">
          <Button
            type="text"
            icon={
              collapsed ? (
                <MenuUnfoldOutlined aria-hidden />
              ) : (
                <MenuFoldOutlined aria-hidden />
              )
            }
            aria-label={collapsed ? '展开菜单' : '收起菜单'}
            aria-expanded={!collapsed}
            aria-controls="side-menu"
            onClick={() => setCollapsed((c) => !c)}
          />
          <span className="ml-auto flex min-w-0 items-center gap-1">
            <UserOutlined aria-hidden />
            <span className="truncate">{username}</span>
          </span>
          <Button
            type="link"
            className="shrink-0 px-1"
            icon={<LogoutOutlined aria-hidden />}
            onClick={logout}
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
        <Modal
          open={confirmingLogout}
          title="确定退出登录？"
          okText="退出登录"
          cancelText="继续编辑"
          onOk={() => {
            setConfirmingLogout(false)
            endSession()
          }}
          onCancel={() => setConfirmingLogout(false)}
        >
          当前页面有未提交的内容，退出后将丢失。
        </Modal>
      </Layout>
    </Layout>
  )
}

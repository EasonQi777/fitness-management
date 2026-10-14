// 测试环境自检：时区数据可用、Ant Design 组件可在 jsdom 中渲染和交互
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, ConfigProvider, Table } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { useState } from 'react'
import { expect, test } from 'vitest'

dayjs.extend(utc)
dayjs.extend(timezone)

test('dayjs 可将 UTC 时间转换为上海时区', () => {
  expect(
    dayjs('2026-01-01T00:00:00Z')
      .tz('Asia/Shanghai')
      .format('YYYY-MM-DD HH:mm:ss'),
  ).toBe('2026-01-01 08:00:00')
})

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <ConfigProvider locale={zhCN}>
      <Button onClick={() => setCount(count + 1)}>点击 {count}</Button>
      <Table rowKey="id" columns={[]} dataSource={[]} />
    </ConfigProvider>
  )
}

test('Ant Design 组件可渲染并响应点击', async () => {
  render(<Counter />)
  // 中文空状态在图标标题和描述中各出现一次
  expect(screen.getAllByText('暂无数据')).not.toHaveLength(0)

  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('button')).toHaveTextContent('1')
})

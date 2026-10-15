import { StyleProvider } from '@ant-design/cssinjs'
import { ConfigProvider } from 'antd'
// 使用 ES 模块版本：CJS 版本经 Vite 开发环境互操作后会多包一层 default，导致中文配置失效
import zhCN from 'antd/es/locale/zh_CN'

/** 应用级 Provider：antd 样式层与中文配置。入口与测试共用，保证测试环境与实际一致 */
export default function AppProviders({ children }) {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN}>{children}</ConfigProvider>
    </StyleProvider>
  )
}

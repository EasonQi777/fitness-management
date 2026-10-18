import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetFaults } from '../mock/faults'

afterEach(() => {
  cleanup()
  resetFaults() // 异常场景只对设置它的测试生效
})

// jsdom 未实现 matchMedia，Ant Design 的响应式组件依赖它
window.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})

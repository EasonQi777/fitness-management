import { expect, test } from 'vitest'
import { getSafeRedirect } from './redirect'

test.each([
  ['/orders', '/orders'],
  ['/orders/new', '/orders/new'],
  ['/orders?tab=expired&page=2', '/orders?tab=expired&page=2'],
  ['/orders/new?from=menu', '/orders/new?from=menu'],
  ['/orders#top', '/orders'], // 丢弃 hash
])('允许站内受保护地址 %s', (value, expected) => {
  expect(getSafeRedirect(value)).toBe(expected)
})

test.each([
  ['空值', null],
  ['非字符串', 123],
  ['空字符串', ''],
  ['外部地址', 'https://evil.com/orders'],
  ['协议相对地址', '//evil.com/orders'],
  ['反斜杠', '/\\evil.com/orders'],
  ['javascript 协议', 'javascript:alert(1)'],
  ['相对路径', 'orders'],
  ['登录页', '/login'],
  ['根路径', '/'],
  ['未知路径', '/admin'],
  ['路径穿越', '/orders/../login'],
  ['相似前缀', '/orders-export'],
  ['子路径', '/orders/new/extra'],
  ['编码的双斜杠', '/%2F%2Fevil.com'],
])('%s 回退到订单列表', (_, value) => {
  expect(getSafeRedirect(value)).toBe('/orders')
})

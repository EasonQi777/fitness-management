// 登录回跳地址校验：只允许站内受保护页面，防止开放重定向。

export const DEFAULT_REDIRECT = '/orders'
const ALLOWED_PATHS = new Set(['/orders', '/orders/new'])
const BASE = 'http://internal.invalid'

/**
 * 返回安全的站内回跳地址（路径 + 查询参数）；不合法时返回默认的订单列表
 * @param {unknown} value
 */
export function getSafeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/'))
    return DEFAULT_REDIRECT
  let url
  try {
    url = new URL(value, BASE)
  } catch {
    return DEFAULT_REDIRECT
  }
  // "//evil.com"、"/\evil.com" 等会改变 origin；"/orders/../login" 会被规范化
  if (url.origin !== BASE || !ALLOWED_PATHS.has(url.pathname))
    return DEFAULT_REDIRECT
  return url.pathname + url.search
}

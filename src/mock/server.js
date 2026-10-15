// 内存模拟服务：只处理已解析的请求对象，与 axios 无关。

import { createErrorBody } from '../api/errors'
import { MockHttpError } from './httpError'
import { cancelOrders, createOrder, listOrders, renewOrders } from './orders'

// ---- token ----
// 无状态 mock token：mock.<base64(JSON { sub, iat })>，刷新页面后仍可校验。
// ponytail: 无签名，仅做格式校验；真实服务端应使用签名 token（如 JWT）。

const TOKEN_PREFIX = 'mock.'

const toBase64 = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const fromBase64 = (b64) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

export const createToken = (username) =>
  TOKEN_PREFIX + toBase64(JSON.stringify({ sub: username, iat: Date.now() }))

/** 校验 token，返回用户名；格式不合法返回 null */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null
  try {
    const { sub } = JSON.parse(fromBase64(token.slice(TOKEN_PREFIX.length)))
    return typeof sub === 'string' && sub.trim() ? sub : null
  } catch {
    return null
  }
}

function requireUser(headers) {
  const match = /^Bearer (\S+)$/.exec(headers.authorization ?? '')
  const user = match && verifyToken(match[1])
  if (!user) throw new MockHttpError('UNAUTHORIZED', '登录已失效，请重新登录')
  return user
}

// ---- 路由 ----

function login({ body }) {
  const username =
    typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const fieldErrors = {}
  if (!username) fieldErrors.username = '请输入账号'
  if (!password.trim()) fieldErrors.password = '请输入密码'
  if (Object.keys(fieldErrors).length)
    throw new MockHttpError('VALIDATION_ERROR', '请输入账号和密码', {
      fieldErrors,
    })
  return { token: createToken(username), username }
}

// 操作日志在 T36 写入，目前为空
const listOperationLogs = () => ({ items: [] })

/** key 为 "METHOD /path"；public 路由不校验 token */
const routes = {
  'POST /auth/login': { handler: login, public: true },
  'GET /orders': { handler: listOrders },
  'POST /orders': { handler: createOrder },
  'POST /orders/renew': { handler: renewOrders },
  'POST /orders/cancel': { handler: cancelOrders },
  'GET /operation-logs': { handler: listOperationLogs },
}

/**
 * 处理一次请求
 * @param {{ method: string, path: string, query: URLSearchParams,
 *   body: unknown, headers: Record<string, string> }} req headers 的键为小写
 * @returns {{ status: number, body: unknown }}
 */
export function handleRequest(req) {
  try {
    const route = routes[`${req.method.toUpperCase()} ${req.path}`]
    if (!route) throw new MockHttpError('NOT_FOUND', '接口不存在')
    const user = route.public ? null : requireUser(req.headers)
    return { status: 200, body: route.handler(req, { user }) }
  } catch (error) {
    if (error instanceof MockHttpError)
      return { status: error.status, body: error.body }
    console.error('[mock]', error)
    return {
      status: 500,
      body: createErrorBody('INTERNAL_ERROR', '服务异常，请稍后重试'),
    }
  }
}

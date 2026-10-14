// axios 自定义 adapter：把 /api 请求交给内存模拟服务，行为尽量与真实 HTTP 一致。

import axios, { AxiosError, CanceledError } from 'axios'
import { handleRequest } from './server'

const API_PREFIX = '/api'

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CanceledError())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener?.(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new CanceledError())
      },
      { once: true },
    )
  })
}

function parseBody(data) {
  if (typeof data !== 'string') return data ?? null
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

/** @param {{ delay?: number }} [options] delay 为模拟网络延迟（毫秒） */
export function createMockAdapter({ delay = 300 } = {}) {
  return async function mockAdapter(config) {
    await wait(delay, config.signal)

    const url = new URL(axios.getUri(config), 'http://mock.local')
    const path = url.pathname.startsWith(API_PREFIX)
      ? url.pathname.slice(API_PREFIX.length) || '/'
      : url.pathname

    const headers = {}
    for (const [k, v] of Object.entries(config.headers?.toJSON?.() ?? {}))
      headers[k.toLowerCase()] = String(v)

    const { status, body } = handleRequest({
      method: config.method ?? 'get',
      path,
      query: url.searchParams,
      body: parseBody(config.data),
      headers,
    })

    // 以 JSON 字符串返回，交给 axios 默认解析，页面拿到的是副本而非 mock 内部对象
    const response = {
      data: JSON.stringify(body),
      status,
      statusText: String(status),
      headers: { 'content-type': 'application/json' },
      config,
      request: null,
    }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    )
  }
}

// 确定性异常场景：用于演示与测试失败、401 和查询竞态。默认全部关闭，普通启动不会随机失败。
//
// 计数类场景表示“接下来 N 次请求失败”，用完后自动恢复，可验证失败后重试。
// 状态与订单数据一样保存在内存中：页面刷新后按环境变量重新计数。
// - 开发环境：在 .env.local 中设置 VITE_MOCK_*（见 .env.example），重启 npm run dev 生效
// - Vitest：调用 setFaults / resetFaults，不读取环境变量
// - Playwright：独立的异常场景服务通过环境变量启动（见 playwright.config.js）

const DEFAULTS = Object.freeze({
  /** 接下来 N 次订单列表查询返回 500 */
  queryFailures: 0,
  /** 接下来 N 次写操作（新建、续卡、撤单）在修改任何数据前返回 500 */
  writeFailures: 0,
  /** 接下来 N 次受保护请求返回 401（登录失效） */
  unauthorized: 0,
  /** 会员姓名包含 keyword 的列表查询额外等待 ms 毫秒，用于复现“先慢后快” */
  slowQuery: null,
})

export const faults = { ...DEFAULTS }

/** @param {Partial<typeof DEFAULTS>} patch */
export const setFaults = (patch) => Object.assign(faults, patch)
export const resetFaults = () => setFaults(DEFAULTS)

const count = (value) => (/^\d+$/.test(value ?? '') ? Number(value) : 0)

/**
 * 解析环境变量；无效值视为关闭
 * @param {Record<string, string | undefined>} env
 */
export function faultsFromEnv(env) {
  const slow = /^(.+):(\d+)$/.exec(env.VITE_MOCK_SLOW_QUERY?.trim() ?? '')
  return {
    queryFailures: count(env.VITE_MOCK_FAIL_QUERY),
    writeFailures: count(env.VITE_MOCK_FAIL_WRITE),
    unauthorized: count(env.VITE_MOCK_UNAUTHORIZED),
    slowQuery: slow ? { keyword: slow[1], ms: Number(slow[2]) } : null,
  }
}

/** 当前计数大于 0 时消耗一次并返回 true */
export function take(name) {
  if (faults[name] <= 0) return false
  faults[name] -= 1
  return true
}

if (import.meta.env.MODE !== 'test') {
  setFaults(faultsFromEnv(import.meta.env))
  const active = Object.entries(faults).filter(([, v]) => v)
  if (active.length)
    console.info('[mock] 已启用异常场景：', Object.fromEntries(active))
}

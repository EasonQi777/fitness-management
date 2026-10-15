// 写操作的公共校验：幂等键、订单引用与版本、原子写入。
// 处理顺序：认证（handleRequest）→ 幂等命中 → 参数与订单校验 → 一次性写入 → 保存幂等结果

import { db } from './db'
import { MockHttpError } from './httpError'

const MAX_KEY_LENGTH = 128

/** 键排序后的 JSON，同一请求体不因字段顺序不同而被判为不同参数 */
function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${fingerprint(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value ?? null)
}

/**
 * 为写接口加上幂等处理。同一用户、同一接口、同一幂等键：
 * - 参数相同：直接返回首次成功的结果，不再执行（成功后的重试不会误报版本冲突）
 * - 参数不同：409 IDEMPOTENCY_CONFLICT
 * 只保存成功结果；校验失败或业务错误不保存，修正后可用同一个键重试。
 * @param {string} endpoint 接口标识，如 "POST /orders/renew"
 * @param {(req: object, ctx: { user: string }) => unknown} handler
 */
export function idempotent(endpoint, handler) {
  return (req, ctx) => {
    const key = req.headers['idempotency-key']?.trim()
    if (!key || key.length > MAX_KEY_LENGTH)
      throw new MockHttpError(
        'VALIDATION_ERROR',
        '缺少有效的 Idempotency-Key 请求头',
      )

    const storeKey = JSON.stringify([ctx.user, endpoint, key])
    const print = fingerprint(req.body)
    const saved = db.idempotency.get(storeKey)
    if (saved) {
      if (saved.print !== print)
        throw new MockHttpError(
          'IDEMPOTENCY_CONFLICT',
          '重复提交的请求与首次提交内容不一致',
        )
      return structuredClone(saved.result)
    }

    const result = handler(req, ctx)
    // 保存副本：之后订单再被修改，重放结果仍是首次提交时的样子
    db.idempotency.set(storeKey, { print, result: structuredClone(result) })
    return result
  }
}

const isRef = (r) =>
  r &&
  typeof r === 'object' &&
  typeof r.id === 'string' &&
  r.id !== '' &&
  Number.isInteger(r.version) &&
  r.version >= 1

const invalid = (o, reason) => ({
  id: o.id,
  orderNo: o.orderNo ?? null,
  reason,
})

/**
 * 校验批量操作的订单引用 [{ id, version }]，全部通过才返回数据库中的订单。
 * 依次检查：结构与重复 → 是否存在 → 版本是否最新 → 业务资格；
 * 每一步都列出全部不合格订单，任一不通过即整批拒绝，不做任何修改。
 * @param {unknown} refs
 * @param {{ check: (order: import('../domain/orderRules').Order) => string | null }} options
 *   check 返回不可操作的原因，可操作时返回 null
 * @returns {import('../domain/orderRules').Order[]}
 */
export function resolveOrders(refs, { check }) {
  if (!Array.isArray(refs) || refs.length === 0)
    throw new MockHttpError('VALIDATION_ERROR', '请至少选择一笔订单')
  if (!refs.every(isRef))
    throw new MockHttpError(
      'VALIDATION_ERROR',
      '订单参数格式不正确，每项需包含 id 与 version',
    )
  const ids = refs.map((r) => r.id)
  const duplicated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  if (duplicated.length)
    throw new MockHttpError(
      'VALIDATION_ERROR',
      `订单重复提交：${duplicated.join('、')}`,
    )

  const byId = new Map(db.orders.map((o) => [o.id, o]))
  const missing = refs.filter((r) => !byId.has(r.id))
  if (missing.length)
    throw new MockHttpError(
      'INVALID_ORDERS',
      `有 ${missing.length} 笔订单不存在或已被删除`,
      { invalidOrders: missing.map((r) => invalid(r, '订单不存在')) },
    )

  const orders = refs.map((r) => byId.get(r.id))
  const stale = orders.filter((o, i) => o.version !== refs[i].version)
  if (stale.length)
    throw new MockHttpError(
      'VERSION_CONFLICT',
      `有 ${stale.length} 笔订单已被修改，请刷新后重试`,
      {
        invalidOrders: stale.map((o) =>
          invalid(o, '订单已被他人修改，请刷新后重试'),
        ),
      },
    )

  const rejected = orders
    .map((o) => ({ o, reason: check(o) }))
    .filter((x) => x.reason)
  if (rejected.length)
    throw new MockHttpError(
      'INVALID_ORDERS',
      `所选订单中有 ${rejected.length} 笔不符合条件`,
      { invalidOrders: rejected.map(({ o, reason }) => invalid(o, reason)) },
    )

  return orders
}

/**
 * 一次性写入已修改的订单（全部校验通过后调用）。
 * 同步执行、中间不会抛错，不会出现部分写入。
 * @param {import('../domain/orderRules').Order[]} updated
 */
export function saveOrders(updated) {
  const byId = new Map(updated.map((o) => [o.id, o]))
  db.orders = db.orders.map((o) => byId.get(o.id) ?? o)
}

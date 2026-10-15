import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ORDER_STATUS } from '../domain/orderStatus'
import { db, resetMockDb } from './db'
import { MockHttpError } from './httpError'
import { idempotent, resolveOrders, saveOrders } from './writes'

// 初始数据中的真实订单
const WANG = { id: 'o-005', orderNo: 'FM20190309001' } // 王建国，已到期，版本 2
const LI = { id: 'o-006', orderNo: 'FM20200721001' } // 李秀英，已到期，版本 1
const ZHENG = { id: 'o-016', orderNo: 'FM20260719001' } // 郑凯，已取消，版本 2

const order = (id) => db.orders.find((o) => o.id === id)
const ref = ({ id }) => ({ id, version: order(id).version })

const onlyExpired = (o) =>
  o.status === 'expired'
    ? null
    : `订单状态为「${ORDER_STATUS[o.status].label}」，仅已到期订单可续卡`

// 以续卡为例的最小处理器，用于验证公共流程（正式续卡接口在 T31 实现）
let executions
const renew = idempotent('POST /orders/renew', ({ body }) => {
  executions++
  const orders = resolveOrders(body.orders, { check: onlyExpired })
  const updated = orders.map((o) => ({
    ...o,
    cardYears: o.cardYears + body.years,
    status: 'pending_review',
    version: o.version + 1,
  }))
  saveOrders(updated)
  return { orders: updated }
})

const KEY = '3f9c2b1e-8d4a-4c6f-9a2b-7e1d5c8f0a34'
const call = (handler, body, { key = KEY, user = 'wangfang' } = {}) =>
  handler({ headers: { 'idempotency-key': key }, body }, { user })

/** 执行并返回 MockHttpError 的状态码与响应体 */
function failure(fn) {
  try {
    fn()
  } catch (e) {
    if (e instanceof MockHttpError) return { status: e.status, ...e.body }
    throw e
  }
  throw new Error('应当失败')
}

beforeEach(() => {
  resetMockDb()
  executions = 0
})

describe('幂等键', () => {
  test.each([
    ['未携带', {}],
    ['为空白', { 'idempotency-key': '  ' }],
    ['超过 128 个字符', { 'idempotency-key': 'k'.repeat(129) }],
  ])('%s：返回 400', (_, headers) => {
    expect(
      failure(() =>
        renew(
          { headers, body: { orders: [ref(WANG)], years: 2 } },
          {
            user: 'wangfang',
          },
        ),
      ),
    ).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    expect(executions).toBe(0)
  })

  test('网络超时后原样重试：返回首次结果，只续卡一次', () => {
    const body = { orders: [ref(WANG)], years: 2 }
    const first = call(renew, body)
    const retry = call(renew, { years: 2, orders: [...body.orders] }) // 字段顺序不同

    expect(retry).toEqual(first)
    expect(executions).toBe(1)
    expect(order(WANG.id)).toMatchObject({ cardYears: 7, version: 3 })
  })

  test('成功后的重试先命中幂等结果，不会因版本已变化而报冲突', () => {
    const body = { orders: [{ id: WANG.id, version: 2 }], years: 2 }
    call(renew, body)
    expect(order(WANG.id).version).toBe(3)
    expect(() => call(renew, body)).not.toThrow()
  })

  test('同一个键提交了不同内容：409 冲突，数据不变', () => {
    call(renew, { orders: [ref(WANG)], years: 2 })
    const before = structuredClone(db.orders)
    expect(
      failure(() => call(renew, { orders: [ref(LI)], years: 5 })),
    ).toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    expect(db.orders).toEqual(before)
  })

  test('不同员工使用相同的键互不影响', () => {
    call(renew, { orders: [ref(WANG)], years: 1 }, { user: 'wangfang' })
    call(renew, { orders: [ref(LI)], years: 1 }, { user: 'lijun' })
    expect(executions).toBe(2)
  })

  test('不同接口使用相同的键互不影响', () => {
    const other = idempotent('POST /orders/cancel', () => ({ ok: true }))
    call(renew, { orders: [ref(WANG)], years: 1 })
    expect(call(other, { orders: [ref(WANG)], years: 1 })).toEqual({ ok: true })
  })

  test('校验失败不保存结果：去掉不合格订单后可用同一个键重新提交', () => {
    expect(
      failure(() => call(renew, { orders: [ref(WANG), ref(ZHENG)], years: 2 })),
    ).toMatchObject({ code: 'INVALID_ORDERS' })

    const result = call(renew, { orders: [ref(WANG)], years: 2 })
    expect(result.orders[0]).toMatchObject({ id: WANG.id, cardYears: 7 })
  })

  test('重放返回首次提交时的结果快照，不受之后的修改影响', () => {
    const body = { orders: [ref(WANG)], years: 2 }
    // 接口响应会被序列化，调用方拿到的是当时的副本
    const first = structuredClone(call(renew, body))
    // 随后审核通过，订单进入待制卡；直接改写记录，验证保存的是快照而非引用
    Object.assign(order(WANG.id), { status: 'pending_card', version: 4 })
    const replay = call(renew, body)
    expect(replay).toEqual(first)
    expect(replay.orders[0]).toMatchObject({
      status: 'pending_review',
      version: 3,
    })
  })
})

describe('订单引用校验', () => {
  const resolve = (refs) => resolveOrders(refs, { check: onlyExpired })

  test.each([
    ['未选择订单', []],
    ['参数不是数组', { id: WANG.id, version: 2 }],
    ['缺失', undefined],
  ])('%s：400 请至少选择一笔订单', (_, refs) => {
    expect(failure(() => resolve(refs))).toMatchObject({
      status: 400,
      message: '请至少选择一笔订单',
    })
  })

  test.each([
    ['缺少版本号', [{ id: WANG.id }]],
    ['版本号是字符串', [{ id: WANG.id, version: '2' }]],
    ['ID 是数字', [{ id: 5, version: 2 }]],
  ])('%s：400 格式不正确', (_, refs) => {
    expect(failure(() => resolve(refs))).toMatchObject({
      status: 400,
      message: '订单参数格式不正确，每项需包含 id 与 version',
    })
  })

  test('同一订单被重复提交：400', () => {
    expect(
      failure(() => resolve([ref(WANG), ref(LI), ref(WANG)])),
    ).toMatchObject({ status: 400, message: `订单重复提交：${WANG.id}` })
  })

  test('订单不存在：列出 ID，订单号为 null', () => {
    expect(
      failure(() => resolve([ref(WANG), { id: 'o-999', version: 1 }])),
    ).toMatchObject({
      status: 400,
      code: 'INVALID_ORDERS',
      invalidOrders: [{ id: 'o-999', orderNo: null, reason: '订单不存在' }],
    })
  })

  test('版本已过期：409，列出订单号', () => {
    expect(
      failure(() => resolve([{ id: WANG.id, version: 1 }, ref(LI)])),
    ).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      invalidOrders: [{ ...WANG, reason: '订单已被他人修改，请刷新后重试' }],
    })
  })

  test('不符合业务条件：列出全部不合格订单及原因', () => {
    const LIU = { id: 'o-016', orderNo: 'FM20260719001' }
    const ZHANG = { id: 'o-010', orderNo: 'FM20251108001' } // 张伟，已完成
    expect(
      failure(() => resolve([ref(WANG), ref(LIU), ref(ZHANG)])),
    ).toMatchObject({
      status: 400,
      code: 'INVALID_ORDERS',
      invalidOrders: [
        { ...LIU, reason: '订单状态为「已取消」，仅已到期订单可续卡' },
        { ...ZHANG, reason: '订单状态为「已完成」，仅已到期订单可续卡' },
      ],
    })
  })

  test('检查顺序：不存在 → 版本 → 资格', () => {
    const missing = { id: 'o-999', version: 1 }
    const stale = { id: WANG.id, version: 1 }
    expect(failure(() => resolve([ref(ZHENG), stale, missing])).code).toBe(
      'INVALID_ORDERS',
    )
    expect(failure(() => resolve([ref(ZHENG), stale])).code).toBe(
      'VERSION_CONFLICT',
    )
  })

  test('全部通过时返回数据库中的订单', () => {
    expect(resolve([ref(WANG), ref(LI)]).map((o) => o.orderNo)).toEqual([
      WANG.orderNo,
      LI.orderNo,
    ])
  })
})

describe('原子写入', () => {
  test('混入一笔已取消订单：整批拒绝，已到期订单也不被修改', () => {
    const before = structuredClone(db.orders)
    failure(() =>
      call(renew, { orders: [ref(WANG), ref(LI), ref(ZHENG)], years: 5 }),
    )
    expect(db.orders).toEqual(before)
  })

  test('全部合格时一次性写入，其他订单保持不变', () => {
    const untouched = db.orders.filter((o) => ![WANG.id, LI.id].includes(o.id))
    call(renew, { orders: [ref(WANG), ref(LI)], years: 5 })
    expect(order(WANG.id)).toMatchObject({
      status: 'pending_review',
      version: 3,
    })
    expect(order(LI.id)).toMatchObject({ status: 'pending_review', version: 2 })
    expect(db.orders.filter((o) => ![WANG.id, LI.id].includes(o.id))).toEqual(
      untouched,
    )
  })

  test('重置数据时清空幂等记录', () => {
    call(renew, { orders: [ref(WANG)], years: 1 })
    resetMockDb()
    call(renew, { orders: [ref(WANG)], years: 1 })
    expect(executions).toBe(2)
  })
})

test('认证由 handleRequest 先于幂等处理执行（见 server.test：未登录返回 401）', () => {
  // idempotent 依赖 ctx.user，handleRequest 在调用处理器前完成认证
  const spy = vi.fn()
  expect(() =>
    idempotent('POST /orders', spy)(
      { headers: {}, body: {} },
      { user: 'wangfang' },
    ),
  ).toThrow(MockHttpError)
  expect(spy).not.toHaveBeenCalled()
})

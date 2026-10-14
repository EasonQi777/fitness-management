// 测试用的门店员工账号与订单片段，取值贴近真实业务。

import { createToken } from '../mock/server'

/** 前台员工 */
export const FRONT_DESK = { username: 'wangfang', password: 'Wf@gym2026' }
/** 门店店长 */
export const MANAGER = { username: 'lijun', password: 'Lj#store0815' }

/** 模拟服务为该员工签发的 token */
export const tokenFor = (user) => createToken(user.username)

/** 以该员工身份写入认证状态所需的数据 */
export const authOf = (user) => ({
  token: tokenFor(user),
  username: user.username,
})

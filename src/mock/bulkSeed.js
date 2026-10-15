// 批量操作测试数据集（仅测试使用，普通启动不加载）。
//
// 场景：某分店的年底续卡跟进名单——2021–2023 年办卡、已到期的老会员 15 笔，
// 以及国庆前促销周末新办、尚在制卡 / 寄卡中的订单 13 笔；另有少量其他状态订单。
// 已到期、可撤单订单均超过一页（每页 10 条），用于跨页批量续卡、撤单与导出。
// 姓名、手机号由固定名单按序组合生成，结果确定。

import { PRICE_PER_YEAR } from '../domain/orderRules'
import { buildOrders } from './seed'

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高'.split('')
const GIVEN_NAMES = (
  '俊杰 雨涵 子轩 欣怡 浩然 梓涵 宇航 诗琪 ' +
  '嘉豪 思雨 晨阳 佳怡 明轩 雅婷 志强 婉清'
).split(' ')
const MOBILE_PREFIXES = ['139', '186', '158', '177', '135', '150', '188', '131']

const pad = (n) => String(n).padStart(2, '0')

/** 以上海时间为基准的日期加减，返回 "YYYY-MM-DD HH:mm:ss" */
function shanghaiTime(date, addDays, hour, minute, second) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + addDays)
  return `${d.toISOString().slice(0, 10)} ${pad(hour)}:${pad(minute)}:${pad(second)}`
}

const memberOf = (i) => ({
  name:
    SURNAMES[i % SURNAMES.length] + GIVEN_NAMES[(i * 3) % GIVEN_NAMES.length],
  phone:
    MOBILE_PREFIXES[i % MOBILE_PREFIXES.length] +
    String((i * 48271 + 10293847) % 1e8).padStart(8, '0'),
})

function bulkRows() {
  const rows = []
  const add = (time, years, status, version, remark) => {
    const { name, phone } = memberOf(rows.length)
    rows.push([
      time,
      name,
      phone,
      years,
      years * PRICE_PER_YEAR,
      status,
      version,
      remark,
    ])
  }

  // 已到期 15 笔：2021 年起约每 53 天一笔，1–2 年卡，均已过期
  const followUps = ['', '年度到期提醒已发送', '电话未接通，已短信通知']
  for (let i = 0; i < 15; i++)
    add(
      shanghaiTime(
        '2021-01-09',
        i * 53,
        9 + (i % 12),
        (i * 17) % 60,
        (i * 29) % 60,
      ),
      1 + (i % 2),
      'expired',
      1,
      followUps[i % followUps.length],
    )

  // 国庆前促销周末新办：待制卡 7 笔、待寄卡 6 笔
  const promoYears = [1, 2, 3, 5, 1, 2, 1]
  for (let i = 0; i < 13; i++)
    add(
      shanghaiTime(
        '2026-09-26',
        i % 2,
        10 + (i % 10),
        (i * 11) % 60,
        (i * 7) % 60,
      ),
      promoYears[i % promoYears.length],
      i < 7 ? 'pending_card' : 'pending_shipping',
      1,
      i % 3 === 0 ? '国庆前促销活动' : '',
    )

  // 其他状态
  add('2026-03-14 15:20:31', 2, 'completed', 1, '')
  add('2026-05-02 11:08:45', 1, 'completed', 1, '')
  add('2026-10-12 18:30:12', 3, 'pending_review', 1, '')
  add('2026-10-13 09:45:58', 1, 'pending_review', 1, '朋友推荐')
  add('2026-09-27 16:12:40', 2, 'cancelled', 2, '客户改为购买私教课')
  return rows
}

/** 批量操作测试数据集：33 笔，已到期 15 笔，待制卡 7 笔，待寄卡 6 笔 */
export const createBulkTestOrders = () => buildOrders(bulkRows())

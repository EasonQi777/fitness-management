// 主流程（36 笔演示数据）。每个测试打开新页面，订单数据从初始状态开始。

import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { parseCsv } from '../src/test/csv.js'
import {
  cell,
  expectTotal,
  login,
  MANAGER,
  openTab,
  rowOf,
  rows,
  searchName,
} from './helpers.js'

test('前台为新会员办 5 年卡：提交后回到列表，新订单在第一行', async ({
  page,
}) => {
  await login(page)
  await expectTotal(page, 36)
  await page.getByRole('menuitem', { name: /新建订单/ }).click()
  await expect(page).toHaveURL('/orders/new')

  await page.getByLabel('会员姓名').fill('周雨桐')
  await page.getByLabel('联系手机号').fill('13816527409')
  await page.getByLabel('购卡年限').fill('5')
  await expect(page.getByTestId('fee')).toContainText('¥ 6,000.00')
  await page.getByLabel('备注').fill('朋友推荐，周末到店领卡')
  await page.getByRole('button', { name: /提交订单/ }).click()

  await expect(page).toHaveURL('/orders')
  await expectTotal(page, 37)
  const first = rows(page).first()
  expect(await cell(first, page, '会员姓名')).toBe('周雨桐')
  expect(await cell(first, page, '订单号')).toMatch(/^FM\d{11}$/)
  expect(await cell(first, page, '购卡年限')).toBe('5 年')
  expect(await cell(first, page, '订单金额（元）')).toBe('6,000.00')
  expect(await cell(first, page, '状态')).toBe('待审核')
})

test('王建国的卡已到期，单条续 5 年：从已到期消失，进行中显示 10 年、待审核，金额不变', async ({
  page,
}) => {
  await login(page)
  await openTab(page, '已到期', 6)
  await rowOf(page, '王建国')
    .getByRole('button', { name: /续\s*卡/ })
    .click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('订单 FM20190309001（王建国）')).toBeVisible()
  await dialog.getByLabel('续卡年限').fill('5')
  await expect(dialog.getByTestId('renew-fees')).toContainText(
    '¥ 4,800.00（原价 ¥ 6,000.00，已享八折）',
  )
  await dialog.getByRole('button', { name: /确认续卡/ }).click()

  await expect(dialog).toBeHidden()
  await expectTotal(page, 5)
  await expect(rowOf(page, '王建国')).toHaveCount(0)

  await openTab(page, '进行中', 19)
  await searchName(page, '王建国', 1)
  const wang = rowOf(page, '王建国')
  expect(await cell(wang, page, '购卡年限')).toBe('10 年')
  expect(await cell(wang, page, '状态')).toBe('待审核')
  expect(await cell(wang, page, '订单金额（元）')).toBe('2,400.00')
})

test('跨状态勾选王建国与范思远导出：预览排除待审核的范思远，文件只有王建国', async ({
  page,
}) => {
  await login(page)
  await rowOf(page, '范思远').getByRole('checkbox').check()
  await openTab(page, '已到期', 6)
  await rowOf(page, '王建国').getByRole('checkbox').check()

  await page.getByRole('button', { name: '导出勾选记录' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('可导出 1 笔，排除 1 笔')).toBeVisible()
  await expect(
    dialog.getByText(/^FM20261014001：订单状态为「待审核」/),
  ).toBeVisible()

  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '确认导出 1 笔' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^订单导出_勾选记录_\d{8}-\d{6}\.csv$/,
  )

  const csv = new TextDecoder().decode(await readFile(await download.path()))
  const [header, ...data] = parseCsv(csv)
  expect(header[1]).toBe('会员姓名')
  expect(data).toEqual([
    [
      'FM20190309001',
      '王建国',
      '5',
      '2,400.00',
      '已到期',
      '2019-03-09 14:30:22',
    ],
  ])
})

test('退出后：后退与直接访问都回到登录页；店长登录后回到想去的页面', async ({
  page,
}) => {
  await login(page)
  await page.getByRole('menuitem', { name: /新建订单/ }).click()
  await expect(page).toHaveURL('/orders/new')

  await page.getByRole('button', { name: /退出登录/ }).click()
  await expect(page).toHaveURL('/login')
  expect(
    await page.evaluate(() => localStorage.getItem('fitness-management:auth')),
  ).toBeNull()

  await page.goBack()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: '订单列表' })).toHaveCount(0)
  await expect(page.getByLabel('会员姓名')).toHaveCount(0)

  await page.goto('/orders/new')
  await expect(page).toHaveURL('/login?redirect=%2Forders%2Fnew')
  await page.getByLabel('账号').fill(MANAGER.username)
  await page.getByLabel('密码').fill(MANAGER.password)
  await page.getByLabel('密码').press('Enter')
  await expect(page).toHaveURL('/orders/new')
  await expect(page.getByText('lijun')).toBeVisible()
})

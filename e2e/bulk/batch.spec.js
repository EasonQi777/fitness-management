// 跨页批量操作：在加载批量测试数据集的独立服务上运行（见 playwright.config.js 的 bulk 项目）。
// 数据集：33 笔，已到期 15 笔，待制卡 7 笔，待寄卡 6 笔，进行中共 15 笔，已取消 1 笔。

import { expect, test } from '@playwright/test'
import { cell, expectTotal, login, openTab, rows } from '../helpers.js'

const selectedCount = (page) => page.locator('[aria-live] strong').first()

async function goToPage(page, n, firstRowsExpected) {
  await page.getByTitle(String(n), { exact: true }).click()
  await expect(page.locator('.ant-pagination-item-active')).toHaveText(
    String(n),
  )
  await expect(rows(page)).toHaveCount(firstRowsExpected)
}

test('跨两页勾选 12 笔已到期订单，批量续 5 年：总额 57,600.00，续卡后已到期只剩 3 笔', async ({
  page,
}) => {
  await login(page)
  await expectTotal(page, 33)
  await openTab(page, '已到期', 15)

  // 第 1 页全选 10 笔，第 2 页再勾 2 笔
  await page.locator('thead .ant-checkbox-input').check()
  await goToPage(page, 2, 5)
  const pickedOnPage2 = [
    await cell(rows(page).nth(0), page, '订单号'),
    await cell(rows(page).nth(1), page, '订单号'),
  ]
  await rows(page).nth(0).getByRole('checkbox').check()
  await rows(page).nth(1).getByRole('checkbox').check()
  await expect(selectedCount(page)).toHaveText('12')

  await page.getByRole('button', { name: '批量续卡' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/共 12 笔订单/)).toBeVisible()
  await dialog.getByLabel('续卡年限').fill('5')
  await expect(dialog.getByTestId('renew-fees')).toContainText(
    '应付总额¥ 57,600.00（12 笔 × ¥ 4,800.00）',
  )
  await dialog.getByRole('button', { name: /确认续卡/ }).click()
  await expect(dialog).toBeHidden()

  // 第 2 页剩余 3 笔回到第 1 页；勾选已清空
  await expectTotal(page, 3)
  await expect(rows(page)).toHaveCount(3)
  await expect(selectedCount(page)).toHaveText('0')
  for (const orderNo of pickedOnPage2)
    await expect(rows(page).filter({ hasText: orderNo })).toHaveCount(0)

  // 12 笔进入进行中，状态为待审核
  await openTab(page, '进行中', 27)
  await page.getByLabel('订单号').fill(pickedOnPage2[0])
  await page.getByRole('button', { name: /查\s*询/ }).click()
  await expectTotal(page, 1)
  expect(await cell(rows(page).first(), page, '状态')).toBe('待审核')
})

test('跨两页勾选全部 13 笔待制卡 / 待寄卡订单批量撤单：确认框列出全部订单号，“再想想”不修改，确认后全部取消', async ({
  page,
}) => {
  await login(page)
  await openTab(page, '进行中', 15)

  const picked = []
  async function tickCancellable() {
    const count = await rows(page).count()
    for (let i = 0; i < count; i++) {
      const row = rows(page).nth(i)
      if (['待制卡', '待寄卡'].includes(await cell(row, page, '状态'))) {
        picked.push(await cell(row, page, '订单号'))
        await row.getByRole('checkbox').check()
      }
    }
  }
  await tickCancellable()
  await goToPage(page, 2, 5)
  await tickCancellable()
  expect(picked).toHaveLength(13)
  await expect(selectedCount(page)).toHaveText('13')

  const cancelButton = page.getByRole('button', { name: '批量撤单' })
  const dialog = page.getByRole('dialog')
  const listedOrderNos = () =>
    dialog.locator('tr.ant-table-row td:first-child').allTextContents()

  // 第一次：核对清单后点“再想想”，订单不变
  await cancelButton.click()
  await expect(dialog.getByText('确认撤销以下 13 笔订单？')).toBeVisible()
  expect(await listedOrderNos()).toEqual(picked)
  await dialog.getByRole('button', { name: /再想想/ }).click()
  await expect(dialog).toBeHidden()
  await openTab(page, '已取消', 1)
  await openTab(page, '进行中', 15)
  await expect(selectedCount(page)).toHaveText('13')

  // 第二次：确认撤单
  await cancelButton.click()
  await dialog.getByRole('button', { name: /确认撤单/ }).click()
  await expect(dialog).toBeHidden()
  await expectTotal(page, 2)
  const statuses = rows(page).locator('td:nth-child(6)')
  await expect(statuses).toHaveText(['待审核', '待审核'])
  await expect(selectedCount(page)).toHaveText('0')

  // 已取消共 14 笔（分两页），按订单号抽查第一页与第二页勾选的订单
  await openTab(page, '已取消', 14)
  for (const orderNo of [picked[0], picked[12]]) {
    await page.getByLabel('订单号').fill(orderNo)
    await page.getByRole('button', { name: /查\s*询/ }).click()
    await expectTotal(page, 1)
    expect(await cell(rows(page).first(), page, '状态')).toBe('已取消')
  }
})

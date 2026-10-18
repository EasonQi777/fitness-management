// 在开启异常场景的独立服务上运行（见 playwright.config.js 的 faults 项目）：
// 每次页面加载后第一次订单查询返回 500；姓名含“袁”的查询额外等待 1.5 秒。

import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号').fill('wangfang')
  await page.getByLabel('密码').fill('Wf@gym2026')
  await page.getByLabel('密码').press('Enter')
  await expect(page).toHaveURL('/orders')
})

test('查询失败：显示错误与重试，重试后恢复', async ({ page }) => {
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('订单加载失败')
  await expect(alert).toContainText('服务异常，请稍后重试')
  await expect(page.locator('tr.ant-table-row')).toHaveCount(0)

  await alert.getByRole('button', { name: /重\s*试/ }).click()
  await expect(page.getByText('共 36 条')).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('先搜“袁”（慢）马上改搜“王”（快）：最终只显示王建国，慢响应不会覆盖', async ({
  page,
}) => {
  await page
    .getByRole('alert')
    .getByRole('button', { name: /重\s*试/ })
    .click()
  await expect(page.getByText('共 36 条')).toBeVisible()

  const name = page.getByLabel('会员姓名')
  const search = page.getByRole('button', { name: /查\s*询/ })
  await name.fill('袁')
  await search.click()
  await name.fill('王')
  await search.click()

  const rows = page.locator('tr.ant-table-row')
  await expect(page.getByText('共 1 条')).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('王建国')
  // 等过慢查询返回的时间（1.5 秒），确认结果仍是王建国
  await page.waitForTimeout(2000)
  await expect(page.getByText('共 1 条')).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('王建国')
  await expect(page).toHaveURL('/orders?memberName=%E7%8E%8B')
})

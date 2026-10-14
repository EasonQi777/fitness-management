import { expect, test } from '@playwright/test'

test('开发页面可以打开', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('健身房会员办卡订单管理后台')).toBeVisible()
  await expect(page.getByText('Get started')).toHaveCount(0)
})

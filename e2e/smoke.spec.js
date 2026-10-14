import { expect, test } from '@playwright/test'

test('未登录访问订单页跳转到登录页并保存回跳地址', async ({ page }) => {
  await page.goto('/orders?page=2')
  await expect(page).toHaveURL('/login?redirect=%2Forders%3Fpage%3D2')
  await expect(page.getByLabel('密码')).toBeVisible()
})

test('未知路径显示 404', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.getByText('页面不存在')).toBeVisible()
})

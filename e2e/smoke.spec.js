import { expect, test } from '@playwright/test'

test('未登录访问订单页跳转到登录页并保存回跳地址', async ({ page }) => {
  await page.goto('/orders?page=2')
  await expect(page).toHaveURL('/login?redirect=%2Forders%3Fpage%3D2')
  await expect(page.getByLabel('密码')).toBeVisible()
})

test('未知路径显示 404', async ({ page }) => {
  await page.goto('/order')
  await expect(page.getByText('页面不存在')).toBeVisible()
})

test('前台员工登录后看到中文订单列表', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号').fill('wangfang')
  await page.getByLabel('密码').fill('Wf@gym2026')
  await page.getByLabel('密码').press('Enter')

  await expect(page).toHaveURL('/orders')
  await expect(page.getByText('共 36 条')).toBeVisible()
  // antd 组件文案来自中文语言包（开发环境曾因 CJS 互操作回退为英文）
  await expect(page.getByText('10 条/页')).toBeVisible()
  await expect(page.getByTitle('下一页')).toBeVisible()
})

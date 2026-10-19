import { expect } from '@playwright/test'

// 门店员工账号（与 src/test/fixtures.js 一致；模拟登录接受任意非空账号密码）
export const FRONT_DESK = { username: 'wangfang', password: 'Wf@gym2026' }
export const MANAGER = { username: 'lijun', password: 'Lj#store0815' }

/** 从登录页登录，进入订单列表。每个测试打开新页面，订单数据从初始状态开始 */
export async function login(page, user = FRONT_DESK) {
  await page.goto('/login')
  await page.getByLabel('账号').fill(user.username)
  await page.getByLabel('密码').fill(user.password)
  await page.getByLabel('密码').press('Enter')
  await expect(page).toHaveURL('/orders')
  await expect(page.locator('.ant-pagination-total-text')).toBeVisible()
}

/** 当前页的数据行 */
export const rows = (page) => page.locator('tr.ant-table-row')

/** 按会员姓名定位一行 */
export const rowOf = (page, name) => rows(page).filter({ hasText: name })

/** 等待列表显示指定总数（查询结束） */
export const expectTotal = (page, n) =>
  expect(page.locator('.ant-pagination-total-text')).toHaveText(`共 ${n} 条`)

/** 切换 Tab 并等待列表总数更新 */
export async function openTab(page, label, total) {
  await page.getByRole('tab', { name: label }).click()
  await expectTotal(page, total)
}

/** 按会员姓名搜索并等待结果总数 */
export async function searchName(page, name, total) {
  await page.getByLabel('会员姓名').fill(name)
  await page.getByRole('button', { name: /查\s*询/ }).click()
  await expectTotal(page, total)
}

/** 读取单元格文本：按表头文字定位列 */
export async function cell(row, page, header) {
  const headers = await page.locator('thead th').allTextContents()
  return row.locator('td').nth(headers.indexOf(header)).textContent()
}

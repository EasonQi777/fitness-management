// 不同屏幕宽度下的布局，以及键盘操作（登录、菜单、表单、弹窗）。

import { expect, test } from '@playwright/test'
import { expectTotal, FRONT_DESK, login, openTab, rowOf } from './helpers.js'

/** 页面是否出现横向滚动、工具栏按钮是否超出卡片、侧边栏与表格滚动区域宽度 */
const measure = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('section').getBoundingClientRect()
    const table = document.querySelector('.ant-table-content, .ant-table-body')
    return {
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
      sider: Math.round(
        document.querySelector('#side-menu').getBoundingClientRect().width,
      ),
      clipped: [...document.querySelectorAll('section button, section input')]
        .filter((el) => !el.closest('.ant-table'))
        .filter((el) => el.getBoundingClientRect().right > card.right + 1)
        .map((el) => el.textContent.trim() || el.placeholder),
      tableScrolls: table.scrollWidth > table.clientWidth,
    }
  })

for (const [width, height, sider, tableScrolls] of [
  [1440, 900, 200, false],
  [768, 1024, 80, true],
  [390, 844, 0, true],
]) {
  test(`${width}px：页面不横向滚动，工具栏完整，表格${tableScrolls ? '在自身区域内横向滚动' : '完整显示'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await login(page)
    // 侧边栏收起有过渡动画，等宽度稳定
    await expect.poll(async () => (await measure(page)).sider).toBe(sider)
    expect(await measure(page)).toEqual({
      pageOverflows: false,
      sider,
      clipped: [],
      tableScrolls,
    })
  })
}

test('390px：顶栏按钮展开菜单，选择后进入页面并自动收起', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  const toggle = page.getByRole('button', { name: '展开菜单' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(page.getByRole('button', { name: '收起菜单' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  await page.getByRole('menuitem', { name: '新建订单' }).click()
  await expect(page).toHaveURL('/orders/new')
  await expect(page.getByRole('button', { name: '展开菜单' })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector('#side-menu').getBoundingClientRect().width,
      ),
    )
    .toBe(0)
})

test('只用键盘：登录，在侧边菜单中用方向键选择新建订单', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('账号')).toBeFocused()
  await page.keyboard.type(FRONT_DESK.username)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('密码')).toBeFocused()
  await page.keyboard.type(FRONT_DESK.password)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/orders')
  await expectTotal(page, 36)

  // 与人操作一致：按方向键直到“新建订单”获得焦点，再回车
  await page.getByRole('menu').focus()
  const target = page.getByRole('menuitem', { name: '新建订单' })
  await expect(async () => {
    await page.keyboard.press('ArrowDown')
    await expect(target).toBeFocused({ timeout: 300 })
  }).toPass()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/orders/new')
  await expect(page.getByRole('heading', { name: '新建订单' })).toBeVisible()
})

test('只用键盘：填写新建订单表单，回车提交', async ({ page }) => {
  await login(page)
  await page.goto('/orders/new')
  await page.getByLabel('会员姓名').focus()
  await page.keyboard.type('周雨桐')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('联系手机号')).toBeFocused()
  await page.keyboard.type('13816527409')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('购卡年限')).toBeFocused()
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/orders')
  await expectTotal(page, 37)
})

test('键盘打开续卡弹窗：焦点进入弹窗，Esc 关闭后焦点回到续卡按钮', async ({
  page,
}) => {
  await login(page)
  await openTab(page, '已到期', 6)
  const renew = rowOf(page, '王建国').getByRole('button', { name: /续\s*卡/ })
  await renew.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement.closest('[role=dialog]')),
    )
    .toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(renew).toBeFocused()
})

test('表单字段都有可见标签，错误提示关联到字段', async ({ page }) => {
  await login(page)
  await page.getByRole('menuitem', { name: '新建订单' }).click()
  await page.getByRole('button', { name: /提交订单/ }).click()
  for (const label of ['会员姓名', '联系手机号', '购卡年限']) {
    const field = page.getByLabel(label)
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    // aria-describedby 可含多个 id（错误提示、字段说明），读屏会一并读出
    const ids = (await field.getAttribute('aria-describedby')).split(' ')
    const described = await page.evaluate(
      (ids) =>
        ids
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      ids,
    )
    expect(described).toContain('请输入')
  }
  await expect(page.getByLabel('备注')).toBeVisible()
})

test('浏览主要页面与弹窗时控制台没有错误或警告', async ({ page }) => {
  const problems = []
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type()))
      problems.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

  await login(page)
  await openTab(page, '已到期', 6)
  await rowOf(page, '王建国')
    .getByRole('button', { name: /续\s*卡/ })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取\s*消/ })
    .click()
  await page.getByRole('button', { name: '导出筛选结果' }).click()
  await expect(page.getByText('可导出 6 笔，排除 0 笔')).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取\s*消/ })
    .click()
  await openTab(page, '进行中', 18)
  await rowOf(page, '谢婉婷').getByRole('checkbox').check()
  await page.getByRole('button', { name: '批量撤单' }).click()
  await page.getByRole('button', { name: /再想想/ }).click()
  await page.getByRole('button', { name: '查看已选' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: '新建订单' }).click()
  await page.getByRole('button', { name: /提交订单/ }).click()
  await expect(page.getByText('请输入会员姓名')).toBeVisible()
  await page.goto('/not-a-page')
  await expect(page.getByText('页面不存在')).toBeVisible()

  expect(problems).toEqual([])
})

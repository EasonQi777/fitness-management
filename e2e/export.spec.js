import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { parseCsv } from '../src/test/csv.js'

test('前台导出已到期订单：浏览器下载的 CSV 可读、中文无乱码、六列结构正确', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('账号').fill('wangfang')
  await page.getByLabel('密码').fill('Wf@gym2026')
  await page.getByLabel('密码').press('Enter')
  await expect(page).toHaveURL('/orders')

  await page.getByRole('tab', { name: '已到期' }).click()
  await expect(page.getByText('共 6 条')).toBeVisible()
  await page.getByRole('button', { name: '导出筛选结果' }).click()
  await expect(page.getByText('可导出 6 笔，排除 0 笔')).toBeVisible()

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '确认导出 6 笔' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(
    /^订单导出_筛选结果_\d{8}-\d{6}\.csv$/,
  )
  await expect(page.getByText('已导出 6 笔订单')).toBeVisible()

  const bytes = await readFile(await download.path())
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM
  const rows = parseCsv(new TextDecoder().decode(bytes))
  expect(rows[0]).toEqual([
    '订单号',
    '会员姓名',
    '购卡年限',
    '订单金额',
    '状态',
    '创建时间',
  ])
  expect(rows).toHaveLength(7)
  expect(rows.every((r) => r.length === 6)).toBe(true)
  const byName = Object.fromEntries(rows.map((r) => [r[1], r]))
  expect(byName['阿依古丽·买买提']).toEqual([
    'FM20211102001',
    '阿依古丽·买买提',
    '2',
    '2,400.00',
    '已到期',
    '2021-11-02 09:05:41',
  ])
  expect(byName['陈志强'][3]).toBe('0.00')
  expect(byName['刘婷'][3]).toBe('')
})

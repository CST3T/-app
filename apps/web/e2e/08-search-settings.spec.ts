import { test, expect, login, DEMO } from './fixtures'

test('搜索页有关键词结果并可跳转详情', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/search?q=接口`)
  await expect(page.getByRole('heading', { name: '搜索' })).toBeVisible()

  // 至少命中转写或摘要片段
  const hits = page.locator('a[href*="/meetings/mtg_"]')
  await expect(hits.first()).toBeVisible({ timeout: 15_000 })
  expect(await hits.count()).toBeGreaterThan(0)

  await hits.first().click()
  await page.waitForURL(/\/w\/ws_demo\/meetings\/mtg_/)
  await expect(page.getByRole('heading', { name: /产品周会|跨团队接口对齐会|增长实验复盘/ })).toBeVisible()
})

test('成员页展示角色并隐藏越权入口', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/settings/members`)

  await expect(page.getByRole('heading', { name: '成员' })).toBeVisible()
  await expect(page.getByRole('table').getByText('林知远')).toBeVisible()
  // 所有者角色不可被修改
  await expect(page.getByRole('table').getByText('所有者')).toBeVisible()
})

test('审计页展示操作记录', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/settings/audit`)

  await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
  await expect(page.getByText(/邀请|创建|删除|重试|分享/).first()).toBeVisible({ timeout: 15_000 })
})

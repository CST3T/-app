import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test('登录后进入会议列表，卡片与状态徽标正确', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  await login(page)
  await expect(page.getByText('产品周会 · Q4 首个迭代')).toBeVisible()
  await expect(page.getByTitle('可重试，已完成阶段不会重复处理')).toBeVisible()
  await expect(page.getByText('跨团队接口对齐会')).toBeVisible()
})

test('未登录访问工作区会被重定向到登录页', async ({ page }) => {
  await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.done}`)
  await page.waitForURL(/\/login/, { timeout: 15_000 })
})

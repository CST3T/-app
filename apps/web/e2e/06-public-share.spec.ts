import { test, expect } from '@playwright/test'

test('公开分享页只读渲染，不出现应用导航', async ({ page }) => {
  await page.goto('/s/shr_demo_weekly_2026')

  await expect(page.getByText('产品周会 · Q4 首个迭代')).toBeVisible()
  await expect(page.getByText(/只读分享/)).toBeVisible()
  // 无侧边栏导航
  await expect(page.getByRole('link', { name: '成员' })).toHaveCount(0)
  // 关键内容块
  await expect(page.getByText('关键结论')).toBeVisible()
})

test('失效的分享 token 给出明确空态', async ({ page }) => {
  await page.goto('/s/shr_not_exist')
  await expect(page.getByText(/分享链接不存在|已过期|已被撤销/)).toBeVisible()
})

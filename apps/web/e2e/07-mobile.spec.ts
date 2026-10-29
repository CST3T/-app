import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test.describe('移动端 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('列表与详情无横向溢出，左侧导航可用', async ({ page }) => {
    await login(page)

    // 移动端左侧导航存在
    await expect(page.getByRole('link', { name: '新建' })).toBeVisible()

    const listOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(listOverflow).toBeLessThanOrEqual(1)

    await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.done}`)
    await expect(page.getByRole('heading', { name: /产品周会/ })).toBeVisible()

    const detailOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(detailOverflow).toBeLessThanOrEqual(1)
  })
})

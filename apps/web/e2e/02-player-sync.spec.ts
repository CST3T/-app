import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test('转写分段点击驱动播放器跳转', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.done}`)
  await expect(page.getByRole('heading', { name: /产品周会/ })).toBeVisible()

  const slider = page.locator('[role="slider"][aria-label="播放进度"]')
  const currentTime = slider.locator('xpath=../span[1]')
  await expect(currentTime).toHaveText('00:00')

  // 第 5 段从 1:52 开始
  await page.getByText('同意。进度要分两段', { exact: false }).click()
  await expect(currentTime).toHaveText('01:52')
})

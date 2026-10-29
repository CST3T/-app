import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test('失败会议可从摘要阶段断点重试并推进到完成', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.failed}`)

  // 失败态：明确的重试入口 + 阶段说明
  await expect(page.getByText('摘要生成失败')).toBeVisible()
  await expect(page.getByText(/转写结果已保留/)).toBeVisible()

  await page.getByRole('button', { name: /^重试$/ }).click()

  // 重试后应离开 failed，进入 summarizing
  await expect(page.getByText('摘要中').first()).toBeVisible({ timeout: 15_000 })

  // SSE 推进到完成（mock 摘要阶段约 6s）
  await expect(page.getByText('处理已完成')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /重新生成摘要/ }).first()).toBeVisible()
})

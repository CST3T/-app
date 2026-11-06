import { test, expect, login } from './fixtures'
import path from 'node:path'

/** 真实中文语音样例：静音音频会被 ASR 拒绝，E2E 必须用有人声的音频 */
const SPEECH_WAV = path.join(__dirname, 'fixtures/sample-zh.wav')

test('上传音频后进入处理流程，状态可推进到完成', async ({ page }) => {
  const wavPath = SPEECH_WAV

  await login(page)
  await page.goto('/w/ws_demo/meetings/new')

  await page.getByLabel('会议标题').fill('E2E 联调验收会')
  await page.locator('input[type="file"]').setInputFiles(wavPath)

  await expect(page.getByText(/sample-zh\.wav/)).toBeVisible()
  await expect(page.getByText(/KB/)).toBeVisible()

  await page.getByRole('button', { name: /开始上传|创建会议|上传/ }).first().click()

  // 上传成功应跳到新建会议的详情页
  await page.waitForURL(/\/meetings\/mtg_/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /E2E 联调验收会/ })).toBeVisible()

  // 状态机推进：转写中 → 摘要中 → 已完成
  await expect(page.getByText('处理已完成')).toBeVisible({ timeout: 45_000 })

  // 摘要与转写均已生成
  await expect(page.getByText('关键结论')).toBeVisible()
})

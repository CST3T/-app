import { test, expect, login } from './fixtures'
import path from 'node:path'
import fs from 'node:fs'

/** 生成一个 1 秒 8kHz 单声道静音 WAV，用于上传链路验证 */
function writeSilentWav(filePath: string) {
  const sampleRate = 8000
  const samples = sampleRate
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(filePath, buffer)
  return filePath
}

test('上传音频后进入处理流程，状态可推进到完成', async ({ page }) => {
  const wavPath = writeSilentWav(path.join(process.cwd(), 'e2e/.tmp-silent.wav'))

  await login(page)
  await page.goto('/w/ws_demo/meetings/new')

  await page.getByLabel('会议标题').fill('E2E 联调验收会')
  await page.locator('input[type="file"]').setInputFiles(wavPath)

  await expect(page.getByText(/\.tmp-silent\.wav/)).toBeVisible()
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

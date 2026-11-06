import { test, expect, login } from './fixtures'
import path from 'node:path'

/** 真实中文语音样例：静音音频会被 ASR 拒绝，E2E 必须用有人声的音频 */
const SPEECH_WAV = path.join(__dirname, 'fixtures/sample-zh.wav')

/** 1x1 透明 PNG，用于资料共享上传 */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('创建会议时可添加成员并分别设置会议身份', async ({ page }) => {
  const wavPath = SPEECH_WAV

  await login(page)
  await page.goto('/w/ws_demo/meetings/new')
  await page.getByLabel('会议标题').fill('E2E 成员邀请会')

  // 创建者固定为主持人
  await expect(page.getByText('主持人').first()).toBeVisible()

  // 添加陈慕 → 设为记录员
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('menuitem', { name: /陈慕/ }).click()
  await page.getByRole('combobox', { name: '陈慕 的会议身份' }).click()
  await page.getByRole('option', { name: /记录员/ }).click()
  await expect(page.getByText('chen@minutes.dev · 负责整理纪要与待办')).toBeVisible()

  // 再添加王砚 → 设为旁听
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('menuitem', { name: /王砚/ }).click()
  await page.getByRole('combobox', { name: '王砚 的会议身份' }).click()
  await page.getByRole('option', { name: /旁听/ }).click()

  // 移除赵时前先添加一次，验证移除按钮
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('menuitem', { name: /赵时/ }).click()
  await page.getByRole('button', { name: '移除 赵时' }).click()
  await expect(page.getByRole('combobox', { name: '赵时 的会议身份' })).toHaveCount(0)

  await page.locator('input[type="file"]').setInputFiles(wavPath)
  await page.getByRole('button', { name: /创建并上传/ }).click()

  await page.waitForURL(/\/meetings\/mtg_/, { timeout: 30_000 })
  await expect(page.getByText('处理已完成')).toBeVisible({ timeout: 45_000 })

  // 创建时的会议身份应原样落在详情页
  await page.getByRole('tab', { name: /成员/ }).click()
  const membersTab = page.getByRole('tabpanel', { name: '成员' })
  await expect(membersTab.getByText('陈慕')).toBeVisible()
  await expect(page.getByText('chen@minutes.dev · 负责整理纪要与待办')).toBeVisible()
  await expect(page.getByText('wang@minutes.dev · 只读，不参与讨论')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '赵时 的会议身份' })).toHaveCount(0)
})

test('详情页可增删参会成员、改会议身份并共享资料', async ({ page }) => {
  await login(page)
  await page.goto('/w/ws_demo/meetings/mtg_01JABCAPI')

  await page.getByRole('tab', { name: /成员/ }).click()
  await expect(page.getByText('创建者').first()).toBeVisible()

  // 添加成员
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('menuitem', { name: /赵时/ }).click()
  await expect(page.getByRole('combobox', { name: '赵时 的会议身份' })).toBeVisible()

  // 修改会议身份
  await page.getByRole('combobox', { name: '赵时 的会议身份' }).click()
  await page.getByRole('option', { name: /记录员/ }).click()
  await expect(page.getByText('赵时 的会议身份已改为「记录员」')).toBeVisible()

  // 移除成员
  await page.getByRole('button', { name: '移除 赵时' }).click()
  await expect(page.getByText('已移除 赵时')).toBeVisible()
  await expect(page.getByRole('combobox', { name: '赵时 的会议身份' })).toHaveCount(0)

  // 资料共享
  await page.getByRole('tab', { name: /资料/ }).click()
  const materialsTab = page.getByRole('tabpanel', { name: '资料' })
  await expect(materialsTab.getByText('SSE 事件协议.md')).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles({
    name: '白板截图.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  })
  // 上传完成后 1.2s 内会同时存在「上传任务行」与「资料卡片」，取第一个即可
  await expect(materialsTab.getByText('白板截图.png').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('img', { name: '白板截图.png' })).toBeVisible()

  // 删除自己上传的资料
  await page.getByRole('button', { name: '删除 白板截图.png' }).click()
  await expect(page.getByText('资料已删除')).toBeVisible()
  await expect(materialsTab.getByText('白板截图.png')).toHaveCount(0)
})

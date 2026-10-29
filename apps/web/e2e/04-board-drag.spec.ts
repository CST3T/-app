import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test('看板拖拽跨列更改待办状态', async ({ page }) => {
  await login(page)
  await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.done}`)
  await page.getByRole('tab', { name: /看板/ }).click()

  const card = page.getByText('待办看板三列拖拽实现')
  await expect(card).toBeVisible()

  const inProgressColumn = page
    .locator('section', { has: page.getByRole('heading', { name: '进行中' }) })
    .first()

  const source = await card.boundingBox()
  const target = await inProgressColumn.boundingBox()
  if (!source || !target) throw new Error('无法定位拖拽目标')

  // dnd-kit 走 pointer 事件，需要真实鼠标轨迹（激活距离 6px）
  await page.mouse.move(source.x + source.width / 2, source.y + 8)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2 + 16, source.y + 24, { steps: 5 })
  await page.mouse.move(target.x + target.width / 2, target.y + 200, { steps: 20 })
  await page.mouse.up()

  await expect(page.getByText(/已移动到「进行中」/)).toBeVisible({ timeout: 10_000 })
  await expect(inProgressColumn.getByText('待办看板三列拖拽实现')).toBeVisible()
})

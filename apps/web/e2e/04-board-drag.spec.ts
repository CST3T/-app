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

  // dnd-kit 走 pointer 事件，需要真实鼠标轨迹（激活距离 6px）。
  // 先把卡片与目标列都滚进视口再取坐标，否则 boundingBox 相对视口会拖空。
  await card.scrollIntoViewIfNeeded()
  await inProgressColumn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const source = await card.boundingBox()
  const target = await inProgressColumn.boundingBox()
  if (!source || !target) throw new Error('无法定位拖拽目标')

  const fromX = source.x + source.width / 2
  const fromY = source.y + source.height / 2
  const toX = target.x + Math.min(target.width / 2, 200)
  const toY = source.y + 40 // 目标列顶部区域即可触发列级 droppable，避免落到视口外

  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(fromX + 12, fromY + 10, { steps: 4 })
  await page.mouse.move(toX, toY, { steps: 24 })
  await page.waitForTimeout(200)
  await page.mouse.up()

  await expect(page.getByText(/已移动到「进行中」/)).toBeVisible({ timeout: 10_000 })
  await expect(inProgressColumn.getByText('待办看板三列拖拽实现')).toBeVisible()
})

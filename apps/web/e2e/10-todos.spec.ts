import { test, expect, login } from './fixtures'

test.describe('待办处理与提醒', () => {
  test('按人展示跨会议待办，逾期可提醒并标记完成', async ({ page }) => {
    await login(page)

    // 左侧导航带逾期数量角标
    const navLink = page.locator('aside a[href$="/todos"]')
    await expect(navLink).toContainText('3')
    await navLink.click()

    await expect(page.getByRole('heading', { name: '待办处理' })).toBeVisible()
    await expect(page.getByText(/项待办已逾期，涉及/)).toBeVisible()

    const wangCard = page.locator('section.panel', { hasText: '王砚' })
    await expect(wangCard).toContainText('前端接入 events 并实现指数退避重连')
    const reconnectRow = wangCard.locator('li', { hasText: '前端接入 events' })
    await expect(reconnectRow).toContainText('跨团队接口对齐会')
    await expect(reconnectRow).toContainText('逾期 1 天')

    // 单项提醒 → 站内消息 + 已提醒标记
    await reconnectRow.getByRole('button', { name: '提醒' }).click()
    await expect(page.getByText(/已向 王砚 发送逾期提醒/)).toBeVisible()
    await expect(reconnectRow.getByText(/已提醒/)).toBeVisible()

    // 一键提醒剩余逾期项
    await page.getByRole('button', { name: /一键提醒 2 项/ }).click()
    await expect(page.getByText(/已向 2 位成员发送 2 条逾期提醒/)).toBeVisible()

    // 待办处理：标记完成
    const rollbackRow = page.locator('li', { hasText: '回滚价格页改版实验' })
    await rollbackRow.getByRole('button', { name: '完成' }).click()
    await expect(page.getByText(/已标记完成：回滚价格页改版实验/)).toBeVisible()
    await expect(rollbackRow.getByText('完成', { exact: true })).toBeVisible()
  })

  test('移动端左侧导航可进入待办页且无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page)

    await page.locator('nav a[href$="/todos"]:visible').click()
    await expect(page.getByRole('heading', { name: '待办处理' })).toBeVisible()
    await expect(page.getByText('会议纪要模板走查并归档到知识库')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

import { test, expect, login, DEMO, MEETINGS } from './fixtures'

test.describe('删除会议', () => {
  test('管理员删除会议后列表移除，直接访问返回不存在', async ({ page }) => {
    await login(page)
    await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.doneApi}`)
    await expect(page.getByRole('heading', { name: '跨团队接口对齐会' })).toBeVisible()

    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '删除会议' }).click()
    await expect(page.getByText('删除这场会议？')).toBeVisible()
    await page.getByRole('button', { name: '确认删除' }).click()

    await expect(page.getByText('会议已删除')).toBeVisible()
    await page.waitForURL(new RegExp(`/w/${DEMO.workspaceId}/meetings$`))
    await expect(page.getByText('跨团队接口对齐会')).toHaveCount(0)
    await expect(page.getByText('产品周会 · Q4 首个迭代').first()).toBeVisible()

    // 同一会话内已软删除：接口应返回 404（整页刷新会重置内存 mock，故这里直接查接口）
    const status = await page.evaluate(async (id) => {
      const token = window.localStorage.getItem('minutes.access_token')
      const res = await fetch(`/api/v1/meetings/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.status
    }, MEETINGS.doneApi)
    expect(status).toBe(404)
  })

  test('访客看不到删除入口', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('邮箱').fill('zhao@minutes.dev')
    await page.getByLabel('密码').fill(DEMO.password)
    await page.getByRole('button', { name: /^登录$/ }).click()
    await page.waitForURL((url) => /\/workspaces$|\/meetings$/.test(url.pathname), {
      timeout: 25_000,
    })

    await page.goto(`/w/${DEMO.workspaceId}/meetings/${MEETINGS.doneApi}`)
    await expect(page.getByRole('heading', { name: '跨团队接口对齐会' })).toBeVisible()
    await page.getByRole('button', { name: '更多操作' }).click()
    await expect(page.getByRole('menuitem', { name: '复制会议链接' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '删除会议' })).toHaveCount(0)
  })
})

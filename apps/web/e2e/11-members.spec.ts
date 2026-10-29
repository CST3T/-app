import { test, expect, login, DEMO } from './fixtures'

test.describe('成员添加与移除', () => {
  test('从人员库调用成员，填写姓名与手机号后加入并移除', async ({ page }) => {
    await login(page)
    await page.locator(`aside a[href$="/settings/members"]`).click()
    await expect(page.getByRole('heading', { name: '成员' })).toBeVisible()

    await page.getByRole('button', { name: '添加成员' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('人员库调用', { exact: true })).toBeVisible()

    // 调用人员库中未加入工作区的孙澄，自动填充姓名与手机号
    await dialog.getByRole('button', { name: /孙澄/ }).click()
    await expect(dialog.getByLabel('姓名')).toHaveValue('孙澄')
    await expect(dialog.getByLabel('手机号')).toHaveValue('13800138005')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()

    await expect(page.getByText(/已添加 孙澄/)).toBeVisible()
    const sunRow = page.locator('tr', { hasText: '孙澄' })
    await expect(sunRow).toContainText('13800138005')

    // 移除
    await sunRow.getByRole('button', { name: '移除' }).click()
    await page.getByRole('button', { name: '确认移除' }).click()
    await expect(page.getByText(/已移除 孙澄/)).toBeVisible()
    await expect(page.locator('tr', { hasText: '孙澄' })).toHaveCount(0)
  })

  test('手动添加需填写姓名与手机号，无效手机号会被拦截', async ({ page }) => {
    await login(page)
    await page.goto(`/w/${DEMO.workspaceId}/settings/members`)

    await page.getByRole('button', { name: '添加成员' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    await expect(dialog.getByText('请填写成员姓名')).toBeVisible()
    await expect(dialog.getByText('请输入正确的 11 位手机号')).toBeVisible()

    await dialog.getByLabel('姓名').fill('顾南')
    await dialog.getByLabel('手机号').fill('13900001111')
    await dialog.getByRole('button', { name: '添加', exact: true }).click()

    await expect(page.getByText(/已添加 顾南/)).toBeVisible()
    const guRow = page.locator('tr', { hasText: '顾南' })
    await expect(guRow).toContainText('13900001111')

    await guRow.getByRole('button', { name: '移除' }).click()
    await page.getByRole('button', { name: '确认移除' }).click()
    await expect(page.locator('tr', { hasText: '顾南' })).toHaveCount(0)
  })
})

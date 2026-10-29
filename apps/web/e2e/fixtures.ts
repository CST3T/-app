import { test as base, expect, type Page } from '@playwright/test'

export const DEMO = {
  email: 'demo@minutes.dev',
  password: 'minutes2026',
  workspaceId: 'ws_demo',
}

export const MEETINGS = {
  done: 'mtg_01JABCWEEKLY',
  doneApi: 'mtg_01JABCAPI',
  failed: 'mtg_01JABCFAILED',
}

/** 登录：单工作区直达会议列表，多工作区先到选择页 */
export async function login(page: Page) {
  const meetings = `/w/${DEMO.workspaceId}/meetings`
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(DEMO.email)
  await page.getByLabel('密码').fill(DEMO.password)
  await page.getByRole('button', { name: /^登录$/ }).click()
  await page.waitForURL((url) => /\/workspaces$|\/meetings$/.test(url.pathname), { timeout: 25_000 })
  if (!page.url().endsWith(meetings)) await page.goto(meetings)
  await expect(page.getByRole('heading', { name: '会议' })).toBeVisible()
}

type Fixtures = {
  authedPage: Page
  /** 真实后端是全局状态，Mock 则每个页面各自重建种子。连真实后端跑时用自动夹具恢复种子。 */
  seedReset: void
}

export const test = base.extend<Fixtures>({
  seedReset: [
    async ({ request }, use) => {
      const url = process.env.E2E_RESET_API
      if (url) {
        const res = await request.post(url)
        if (!res.ok()) throw new Error(`seed reset failed with ${res.status()}`)
      }
      await use()
    },
    { auto: true },
  ],
  authedPage: async ({ page }, use) => {
    await login(page)
    await use(page)
  },
})

export { expect }

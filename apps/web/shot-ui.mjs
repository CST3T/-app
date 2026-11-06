import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const SHOTS = process.env.SHOTS ?? '../.screenshots'

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${BASE}/login`)
  await page.getByLabel('邮箱').fill('demo@minutes.dev')
  await page.getByLabel('密码').fill('minutes2026')
  await page.getByRole('button', { name: /^登录$/ }).click()
  await page.waitForURL(/\/workspaces$|\/meetings$/, { timeout: 25000 })
  await page.goto(`${BASE}/w/ws_demo/meetings`)
  await page.locator('article').first().waitFor()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${SHOTS}/ui-list.png` })

  await page.locator('article').first().click()
  await page.waitForURL(/\/meetings\/mtg_/, { timeout: 20000 })
  await page.getByText('关键结论').first().waitFor({ timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${SHOTS}/ui-detail.png` })

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.goto(`${BASE}/login`)
  await mobile.getByLabel('邮箱').fill('demo@minutes.dev')
  await mobile.getByLabel('密码').fill('minutes2026')
  await mobile.getByRole('button', { name: /^登录$/ }).click()
  await mobile.waitForURL(/\/workspaces$|\/meetings$/, { timeout: 20000 })
  await mobile.goto(`${BASE}/w/ws_demo/meetings`)
  await mobile.locator('article').first().waitFor()
  await mobile.waitForTimeout(800)
  await mobile.screenshot({ path: `${SHOTS}/ui-mobile.png` })
  console.log('shots ok')
  await browser.close()
}

run().catch((e) => {
  console.error('FAILED', e)
  process.exit(1)
})

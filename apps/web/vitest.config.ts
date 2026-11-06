import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // e2e 目录由 Playwright 负责；vitest 只收集单元测试
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    environment: 'jsdom',
    passWithNoTests: true,
  },
})

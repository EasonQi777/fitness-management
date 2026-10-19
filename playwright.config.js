import { defineConfig, devices } from '@playwright/test'

const port = 5174
// 异常场景使用独立的开发服务，不影响主流程测试的默认数据与行为
const faultPort = 5175
// 跨页批量操作使用批量测试数据集（已到期 15 笔、可撤单 13 笔，均超过一页）
const bulkPort = 5176

export default defineConfig({
  testDir: './e2e',
  // 刚执行 npm ci 后首次运行时，三个开发服务需要冷启动编译依赖，默认 30 秒可能不够
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['faults/**', 'bulk/**'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${port}`,
      },
    },
    {
      name: 'bulk',
      testMatch: 'bulk/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${bulkPort}`,
      },
    },
    {
      name: 'faults',
      testMatch: 'faults/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${faultPort}`,
      },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev -- --port ${faultPort} --strictPort`,
      url: `http://localhost:${faultPort}`,
      // 环境变量必须随服务启动；不复用已有服务，避免误用未开启异常场景的实例
      reuseExistingServer: false,
      env: {
        VITE_MOCK_FAIL_QUERY: '1',
        VITE_MOCK_SLOW_QUERY: '袁:1500',
      },
    },
    {
      command: `npm run dev -- --port ${bulkPort} --strictPort`,
      url: `http://localhost:${bulkPort}`,
      reuseExistingServer: false,
      env: { VITE_MOCK_DATASET: 'bulk' },
    },
  ],
})

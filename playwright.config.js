import { defineConfig, devices } from '@playwright/test'

const port = 5174
// 异常场景使用独立的开发服务，不影响主流程测试的默认数据与行为
const faultPort = 5175

export default defineConfig({
  testDir: './e2e',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: 'faults/**',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${port}`,
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
  ],
})

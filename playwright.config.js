import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // 串行执行避免DB冲突
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://localhost:4001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4001',
      },
    },
  ],
  webServer: {
    command: 'node src/server.js',
    url: 'http://localhost:4001',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
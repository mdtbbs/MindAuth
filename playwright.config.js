import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT || process.env.PORT || '4001';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // 串行执行避免DB冲突
  reporter: [['html'], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
      },
    },
  ],
  webServer: {
    command: `node src/server.js`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      ...process.env,
      PORT: port,
      BASE_URL: baseURL,
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || `http://localhost:3000,http://localhost:4000,http://localhost:4001,${baseURL}`,
      USE_MEMORY_REDIS: process.env.USE_MEMORY_REDIS || '1',
    },
  },
});

// Playwright 配置：测试跑在本地静态服务器上（见 tests/server.js）。
// AI 一律用路由 mock（见 tests/smoke.spec.js 的 mockAI），不发真实网络请求。
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    viewport: { width: 402, height: 874 },
    baseURL: 'http://localhost:8123'
  },
  webServer: {
    command: 'node tests/server.js',
    port: 8123,
    reuseExistingServer: true,
    timeout: 15000
  }
});

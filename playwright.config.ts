import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',
  timeout:30000,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?'github':'list',
  use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4173',acceptDownloads:true,trace:'retain-on-failure'},
  webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173/CadRecon/',reuseExistingServer:!process.env.CI,timeout:120000}
});
import { defineConfig } from '@playwright/test';

// Tests run with the Chromium in PLAYWRIGHT_BROWSERS_PATH (for example /opt/pw-browsers). Do not run "playwright install" in CI
// when the browsers are already in the image.
export default defineConfig({
  testDir: './tests',
  timeout: 15 * 60 * 1000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});

import { defineConfig } from 'playwright/test';

export default defineConfig({
  timeout: 120_000,
  use: {
    viewport: { width: 1400, height: 900 },
    headless: true,
  },
});

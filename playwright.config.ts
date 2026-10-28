import { defineConfig, devices } from '@playwright/test';

// The @net Trystero spec self-skips when no tracker is reachable; NET=0 excludes it.
const NO_NET = process.env.NET === '0';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  grepInvert: NO_NET ? /@net/ : undefined,
  use: {
    baseURL: 'http://localhost:4173/battleship/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/battleship/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Real host candidates so two contexts can reach each other without mDNS.
        launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] },
      },
    },
  ],
});

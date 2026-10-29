import { defineConfig, devices } from '@playwright/test';

// The @net Trystero spec self-skips when no tracker is reachable; NET=0 excludes it.
const NO_NET = process.env.NET === '0';
// WEBKIT=1 adds the Safari-engine project (needs `npx playwright install --with-deps webkit`).
const WEBKIT = !!process.env.WEBKIT;

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
    baseURL: 'http://localhost:4174/battleship/',
    trace: 'retain-on-failure',
  },
  // Its own outDir and port, so a concurrent `vite build` into dist/ can't change files under a running test.
  webServer: {
    command: 'npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4174 --strictPort',
    url: 'http://localhost:4174/battleship/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /webkit\.spec/,
      use: {
        ...devices['Desktop Chrome'],
        // Real host candidates so two contexts can reach each other without mDNS.
        launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] },
      },
    },
    ...(WEBKIT ? [{ name: 'webkit', testMatch: /webkit\.spec/, use: { ...devices['iPhone 13'] } }] : []),
  ],
});

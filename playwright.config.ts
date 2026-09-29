import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 27019);
const baseURL = `http://localhost:${PORT}`;

export const E2E_SECRETS = {
  cron: "e2e-cron-secret-0123456789",
  setup: "e2e-setup-secret-0123456789",
};

/**
 * Full-stack E2E: a throwaway in-memory MongoDB replica set + `next dev` with
 * ENABLE_TEST_CLOCK=true, so the suite can move the *server* clock day by day.
 * The test clock is hard-disabled when NODE_ENV=production (src/lib/time/clock.ts).
 * Uses its own distDir so it can run next to a regular dev server.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "pnpm db:memory",
      port: DB_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { MEMORY_DB_PORT: String(DB_PORT) },
    },
    {
      command: `pnpm exec next dev --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        ENABLE_TEST_CLOCK: "true",
        MONGODB_URI: `mongodb://127.0.0.1:${DB_PORT}/?replicaSet=testset`,
        MONGODB_DB: "quiz_app_e2e",
        NEXT_PUBLIC_APP_URL: baseURL,
        EMAIL_PROVIDER: "console",
        CRON_SECRET: E2E_SECRETS.cron,
        ADMIN_SETUP_SECRET: E2E_SECRETS.setup,
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

// Override with PORT=xxxx when something else is already on 3000 —
// reuseExistingServer would otherwise point the tests at the wrong app.
const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    // Allow file downloads (needed for the export assertions)
    acceptDownloads: true,
    // Slightly slower actions to let React re-renders settle
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Use the production build (next start) — no Turbopack, starts in ~200ms,
  // avoids the SQLite EPERM crash on FUSE-mounted volumes.
  webServer: {
    command: `PORT=${PORT} npm start`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

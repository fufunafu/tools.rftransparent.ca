import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:3000";
const storageState = process.env.E2E_STORAGE_STATE || undefined;
const mobileStorageState = process.env.E2E_MOBILE_STORAGE_STATE || storageState;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run start -- --hostname 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "webkit-iphone-se",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone SE (3rd gen)"], storageState: mobileStorageState },
    },
    {
      name: "webkit-iphone",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 15"], storageState: mobileStorageState },
    },
    {
      name: "webkit-iphone-pro-max",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 15 Pro Max"], storageState: mobileStorageState },
    },
    {
      name: "webkit-ipad",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPad (gen 11)"], storageState: mobileStorageState },
    },
  ],
});

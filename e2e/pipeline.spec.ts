import { expect, test } from "@playwright/test";

const pipelineFixture = {
  metrics: {
    totalQuotedValue: 210000,
    wonRevenue: 92000,
    conversionRate: 44,
    valueWinRate: 43.8,
    avgCycleTimeDays: 9,
    pipelineValue: 68000,
    avgSaleValue: 11500,
    totalDrafts: 18,
    completedDrafts: 8,
    openDrafts: 4,
    invoiceSentDrafts: 6,
    predictedRevenue: 41000,
    predictedTimelineDays: 28,
    monthlyTrend: [
      { month: "2026-06", draftsCreated: 8, draftsConverted: 3, conversionRate: 37.5, pipelineValue: 28000, revenue: 34000 },
      { month: "2026-07", draftsCreated: 10, draftsConverted: 5, conversionRate: 50, pipelineValue: 40000, revenue: 58000 },
    ],
  },
  prediction: {
    totalPipelineValue: 68000,
    totalPredictedRevenue: 41000,
    avgMonthlyRevenue: 52000,
    avgCycleTimeDays: 9,
    startingMonth: "Jul 2026",
    startingRevenue: 58000,
    monthlyForecasts: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(((index + 7) % 12) + 1).padStart(2, "0")}`,
      monthLabel: `Month ${index + 1}`,
      forecast: 60000 + index * 1000,
      prevMonthRevenue: 58000 + index * 1000,
      momRate: 0.03,
      momRateCapped: false,
      fromPipeline: index < 3 ? 12000 - index * 3000 : 0,
      isFallback: index > 8,
    })),
    annualForecast: 786000,
    fallbackMomRates: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index, 0.03])),
    buckets: [
      { label: "0-14 days", drafts: 2, value: 28000, conversionRate: 70, predictedValue: 19600 },
      { label: "15-30 days", drafts: 2, value: 20000, conversionRate: 50, predictedValue: 10000 },
      { label: "31-60 days", drafts: 1, value: 12000, conversionRate: 35, predictedValue: 4200 },
      { label: "61+ days", drafts: 1, value: 8000, conversionRate: 20, predictedValue: 1600 },
    ],
    seasonalPattern: Array.from({ length: 12 }, (_, index) => ({
      month: `2025-${String(index + 1).padStart(2, "0")}`,
      monthLabel: `M${index + 1}`,
      revenue: 42000 + index * 1200,
      momGrowth: index === 0 ? null : 0.03,
    })),
  },
  channelMetrics: {
    totalOrders: 26,
    totalRevenue: 154000,
    draftOrders: 8,
    draftRevenue: 92000,
    draftAOV: 11500,
    directOrders: 18,
    directRevenue: 62000,
    directAOV: 3444,
    draftRevenueShare: 59.7,
    employeeBreakdown: [
      { repTag: "alex", repName: "Alex", orders: 5, revenue: 57000, aov: 11400 },
      { repTag: "jordan", repName: "Jordan", orders: 3, revenue: 35000, aov: 11667 },
    ],
    monthlyTrend: [],
  },
  leaderboard: [
    { repTag: "alex", repName: "Alex", totalDrafts: 10, completedDrafts: 5, openDrafts: 2, conversionRate: 50, totalQuoted: 120000, wonRevenue: 57000, avgCycleTimeDays: 8, avgSaleValue: 11400, pipelineValue: 26000 },
    { repTag: "jordan", repName: "Jordan", totalDrafts: 8, completedDrafts: 3, openDrafts: 2, conversionRate: 37.5, totalQuoted: 90000, wonRevenue: 35000, avgCycleTimeDays: 11, avgSaleValue: 11667, pipelineValue: 42000 },
  ],
  stores: [
    { id: "store1", label: "Toronto" },
    { id: "store2", label: "Montreal" },
  ],
  period: { from: "2026-07-14", to: "2026-08-13", days: 30 },
  cachedAt: "2026-08-13T14:00:00.000Z",
};

test.describe("authenticated pipeline dashboard", () => {
  test.skip(
    !process.env.E2E_STORAGE_STATE,
    "Set E2E_STORAGE_STATE to a Playwright storage-state file for authenticated pipeline tests.",
  );

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/shopify/pipeline?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "X-Pipeline-Cache": "miss" },
        body: JSON.stringify(pipelineFixture),
      });
    });
  });

  test("supports keyboard tabs, selected state, and browser history", async ({ page }) => {
    await page.goto("/pipeline?view=overview");

    const overview = page.getByRole("tab", { name: /Overview/ });
    const forecast = page.getByRole("tab", { name: /Forecast/ });
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await overview.focus();
    await overview.press("ArrowRight");

    await expect(page).toHaveURL(/view=forecast/);
    await expect(forecast).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Monthly revenue forecast", exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/view=overview/);
    await expect(overview).toHaveAttribute("aria-selected", "true");
  });

  test("keeps each primary metric and chart in its intended tab", async ({ page }) => {
    await page.goto("/pipeline?view=overview");
    await page.getByRole("button", { name: "30d" }).click();

    await expect(page.getByRole("heading", { name: "Monthly pipeline trend", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly revenue forecast", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rep leaderboard", exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: /Forecast/ }).click();
    await expect(page.getByRole("heading", { name: "Monthly revenue forecast", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly pipeline trend", exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: /Team/ }).click();
    await expect(page.getByRole("heading", { name: "Rep leaderboard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quote revenue by employee", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly revenue forecast", exact: true })).toHaveCount(0);
  });

  test("retains the active tab while filters refresh data", async ({ page }) => {
    await page.goto("/pipeline?view=team");
    await page.getByRole("button", { name: "30d" }).click();
    await expect(page.getByRole("heading", { name: "Rep leaderboard", exact: true })).toBeVisible();

    await page.getByLabel("Store").selectOption("store1");
    await expect(page).toHaveURL(/view=team/);
    await expect(page.getByRole("tab", { name: /Team/ })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Custom" }).click();
    await page.getByLabel("Start date").fill("2026-07-01");
    await expect(page).toHaveURL(/view=team/);
    await expect(page.getByRole("heading", { name: "Rep leaderboard", exact: true })).toBeVisible();
  });

  test("contains tabs and wide tables at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pipeline?view=team");
    await page.getByRole("button", { name: "30d" }).click();

    const tabList = page.getByRole("tablist", { name: "Pipeline views" });
    const tabScroller = tabList.locator("..");
    await expect.poll(async () => tabScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

    const leaderboard = page.locator('[data-content-id="rep-leaderboard"]');
    const tableScroller = leaderboard.locator("div.overflow-x-auto");
    await expect.poll(async () => tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

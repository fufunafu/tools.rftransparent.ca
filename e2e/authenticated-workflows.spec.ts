import { expect, test } from "@playwright/test";

test.describe("authenticated workflows", () => {
  test.skip(
    !process.env.E2E_STORAGE_STATE,
    "Set E2E_STORAGE_STATE to a Playwright storage-state file for authenticated smoke tests.",
  );

  const routes = [
    { path: "/", label: "home dashboard" },
    { path: "/todos", label: "tasks" },
    { path: "/customer-service/problems", label: "problem tickets" },
    { path: "/settings/account", label: "account settings" },
    { path: "/bugs", label: "bug reporting" },
  ];

  for (const route of routes) {
    test(`loads ${route.label}`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByText("This page could not be loaded")).toHaveCount(0);
    });
  }

  test("opens role-filtered page search", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();

    await expect(page.getByRole("dialog", { name: "Search pages" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search pages" })).toBeFocused();
  });
});

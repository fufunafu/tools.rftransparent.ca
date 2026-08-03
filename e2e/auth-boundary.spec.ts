import { expect, test } from "@playwright/test";

const protectedRoutes = [
  "/",
  "/todos",
  "/customer-service/problems",
  "/warehouse/purchasing",
  "/settings/access",
];

for (const route of protectedRoutes) {
  test(`redirects signed-out visitors from ${route} to login`, async ({ page }) => {
    await page.goto(route);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
}

test("offers an accessible password login form", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with email and password" }).click();

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
});

test("explains when a Google account is not authorized", async ({ page }) => {
  await page.goto("/login?error=not_authorized");

  await expect(
    page.getByRole("alert").filter({ hasText: "isn't authorized" }),
  ).toBeVisible();
});

test("keeps token-based employee surveys public", async ({ page }) => {
  await page.goto("/survey/invalid-smoke-test-token");

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText("This survey link is invalid or has expired.")).toBeVisible();
});

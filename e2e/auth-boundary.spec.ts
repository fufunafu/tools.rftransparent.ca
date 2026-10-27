import { expect, test } from "@playwright/test";

// These checks prove the signed-out boundary even when the wider E2E run is
// given an authenticated storage state for the workflow specs.
test.use({ storageState: { cookies: [], origins: [] } });

const protectedRoutes = [
  "/",
  "/todos",
  "/customer-service/problems",
  "/warehouse/purchasing",
  "/settings/access",
  "/employees/new",
];

for (const route of protectedRoutes) {
  test(`redirects signed-out visitors from ${route} to login`, async ({ page }) => {
    await page.goto(route);

    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "This link is not available" })).toBeVisible();
  await expect(page.getByText("This survey link is invalid. Ask your manager for a new link.")).toBeVisible();
});

test("serves Apple universal-link association files publicly without redirects", async ({ request }) => {
  for (const path of [
    "/.well-known/apple-app-site-association",
    "/apple-app-site-association",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const association = await response.json() as {
      applinks?: { details?: Array<{ appIDs?: string[] }> };
    };
    expect(association.applinks?.details?.[0]?.appIDs).toContain(
      "94BK7NCPL9.ca.rftransparent.tools",
    );
  }
});

test("serves native version and maintenance policy without an employee session", async ({ request }) => {
  const version = await request.get("/api/native/version", { maxRedirects: 0 });
  expect(version.status()).toBe(200);
  expect(version.headers()["cache-control"]).toContain("no-store");
  await expect(version.json()).resolves.toMatchObject({
    minimumBuild: expect.any(Number),
    recommendedBuild: expect.any(Number),
    currentVersion: expect.any(String),
  });

  const status = await request.get("/api/native/status", { maxRedirects: 0 });
  expect(status.status()).toBe(200);
  expect(status.headers()["cache-control"]).toContain("no-store");
  await expect(status.json()).resolves.toMatchObject({
    state: expect.stringMatching(/^(operational|maintenance)$/),
  });
});

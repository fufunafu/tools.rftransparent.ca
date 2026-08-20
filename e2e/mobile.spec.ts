import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const authenticated = Boolean(process.env.E2E_MOBILE_STORAGE_STATE || process.env.E2E_STORAGE_STATE);

const homeFixture = {
  profile: {
    id: "employee-1",
    name: "Jordan Employee",
    department: "warehouse",
    locationName: "Toronto",
  },
  clock: {
    linked: true,
    open: null,
    week: [{ date: "2026-08-13", label: "Thu", minutes: 120, open: false }],
    weekMinutes: 120,
  },
  tasks: { active: 4, dueToday: 2, overdue: 1 },
  roleActions: [
    { id: "warehouse-report", label: "Daily report", description: "Record today's production", href: "/warehouse/report" },
    { id: "order-stream", label: "Order Stream", description: "Open the shipping tool", href: "https://orderstream-checker.vercel.app/", external: true },
  ],
};

const clockFixture = {
  linked: true,
  employeeName: "Jordan Employee",
  locationName: "Toronto",
  geofenced: true,
  geofenceReady: true,
  open: null,
  week: [{ date: "2026-08-13", label: "Thu", minutes: 120, open: false }],
  weekMinutes: 120,
};

async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test("mobile login exposes labelled, keyboard-focusable controls", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with email and password" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  for (const control of [
    page.getByLabel("Email"),
    page.getByLabel("Password"),
    page.getByRole("button", { name: "Sign in", exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await noPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});

test.describe("authenticated mobile shell", () => {
  test.skip(!authenticated, "Set E2E_MOBILE_STORAGE_STATE to a frontline employee storage-state file.");

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/mobile/home", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(homeFixture),
    }));
  });

  test("restores the authenticated session and shows daily status with four primary tabs", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Jordan/ })).toBeVisible();
    await expect(page.getByText("Due today")).toBeVisible();
    await expect(page.getByText("Overdue")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("link", { name: "Home" }))
      .toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await noPageOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("renders an explicit Home exception when no employee profile is linked", async ({ page }) => {
    await page.route("**/api/mobile/home", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...homeFixture,
        profile: null,
        clock: { ...homeFixture.clock, linked: false, open: null },
        tasks: { active: 0, dueToday: 0, overdue: 0 },
      }),
    }));
    await page.goto("/");
    await expect(page.getByText("Your login is not linked to an employee profile.")).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toHaveCount(3);
  });

  test("renders an explicit Home error and Retry action", async ({ page }) => {
    await page.route("**/api/mobile/home", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Daily view unavailable" }),
    }));
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Your daily view is unavailable");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("supports tab navigation and contextual Back on a detail screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/todos$/);
    await page.goto("/warehouse/report");
    await expect(page.getByRole("button", { name: /Back from Daily Report/i })).toBeVisible();
  });

  test("renders the personal Tasks workflow with touch-sized controls", async ({ page }) => {
    await page.route("**/api/todos**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    }));
    await page.goto("/todos");
    await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
    await expect(page.getByLabel("Task title")).toBeVisible();
    await expect(page.getByLabel("Task filters")).toBeVisible();
    for (const control of [
      page.getByRole("button", { name: "Add task" }),
      page.getByRole("button", { name: "Today", exact: true }),
      page.getByRole("button", { name: "All", exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await noPageOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("keeps More destinations unique and marks external tools", async ({ page }) => {
    await page.goto("/more");
    const hrefs = await page.locator("main a[href]").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const external = page.locator('main a[target="_blank"]');
    for (let index = 0; index < await external.count(); index += 1) {
      await expect(external.nth(index)).toContainText("Opens outside RF Tools");
    }
    await expect(page.getByText("Connection")).toBeVisible();
    await expect(page.getByText("Environment")).toBeVisible();
    await expect(page.getByRole("link", { name: "Home" })).toHaveCount(1);
    await expect(page.locator('main a[href="/clock"]')).toHaveCount(0);
    await expect(page.locator('main a[href="/todos"]')).toHaveCount(0);
    await expect(page.locator('main a[href="/sales"]')).toHaveCount(0);
    await expect(page.locator('main a[href="/warehouse/report"]')).toHaveCount(1);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("warehouse reporting never sends a client-selected employee identity", async ({ page }) => {
    test.skip(process.env.E2E_MOBILE_DEPARTMENT !== "warehouse", "Use a warehouse employee storage state and set E2E_MOBILE_DEPARTMENT=warehouse.");
    await page.route("**/api/warehouse/reports?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/warehouse/reports", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "report", report_date: "2026-08-13", boxes_built: 1, orders_packed: 2, walkin_pickup: 3, notes: null, updated_at: new Date().toISOString() }),
      });
    });
    await page.goto("/warehouse/report");
    await expect(page.getByLabel("Your Name")).toHaveCount(0);
    await page.getByLabel("Boxes built").fill("1");
    await page.getByLabel("Orders packed").fill("2");
    await page.getByLabel("Walk-in and pick-up").fill("3");
    await page.getByRole("button", { name: "Submit my report" }).click();
    await expect(page.getByText("Report submitted.")).toBeVisible();
    expect(requestBody).not.toHaveProperty("employee_id");
    expect(requestBody).not.toHaveProperty("employeeId");
  });

  test("explains location use and handles permission denial", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => error({
            code: 1,
            message: "Permission denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
        },
      });
    });
    await page.route("**/api/clock", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clockFixture) });
      } else await route.continue();
    });
    await page.goto("/clock");
    await page.getByRole("button", { name: "Clock In" }).click();
    await expect(page.getByRole("dialog", { name: "Confirm you are at the store" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("Location access is off");
  });

  test("clocks in and out once per tap and announces only server-confirmed success", async ({ page }) => {
    const submitted: unknown[] = [];
    let postCount = 0;
    let open: { id: string; clockInAt: string; stale: boolean } | null = null;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (success: PositionCallback) => success({
            timestamp: Date.now(),
            coords: { latitude: 43.65, longitude: -79.38, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
            toJSON: () => ({}),
          }),
        },
      });
    });
    await page.route("**/api/clock", async (route) => {
      if (route.request().method() === "POST") {
        postCount += 1;
        const body = route.request().postDataJSON();
        submitted.push(body);
        await new Promise((resolve) => setTimeout(resolve, 150));
        open = body.action === "in"
          ? { id: "shift", clockInAt: new Date().toISOString(), stale: false }
          : null;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...clockFixture, open }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...clockFixture, open }) });
      }
    });
    await page.goto("/clock");
    await page.getByRole("button", { name: "Clock In" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: /One sec|Checking/ })).toBeDisabled();
    await expect(page.getByText("Clock-in confirmed by RF Tools.")).toHaveCount(0);
    await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Clock-in confirmed by RF Tools.");
    expect(postCount).toBe(1);
    expect(submitted[0]).toMatchObject({
      action: "in",
      position: {
        latitude: 43.65,
        longitude: -79.38,
        accuracy: 10,
        capturedAt: expect.any(String),
      },
    });
    await page.getByRole("button", { name: "Clock Out" }).click();
    await expect(page.getByRole("status")).toContainText("Clock-out confirmed by RF Tools.");
    await expect(page.getByRole("button", { name: "Clock In" })).toBeVisible();
    expect(postCount).toBe(2);
    expect(submitted[1]).toEqual({ action: "out" });
  });

  test("shows the stale-shift recovery state before another clock-in", async ({ page }) => {
    await page.route("**/api/clock", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...clockFixture,
        open: { id: "stale", clockInAt: "2026-08-12T08:00:00.000Z", stale: true },
      }),
    }));
    await page.goto("/clock");
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByLabel("When your shift actually ended")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clock In" })).toHaveCount(0);
  });

  test("rejects an inaccurate browser location before contacting the server", async ({ page }) => {
    let postCount = 0;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (success: PositionCallback) => success({
            timestamp: Date.now(),
            coords: { latitude: 43.65, longitude: -79.38, accuracy: 250, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
            toJSON: () => ({}),
          }),
        },
      });
    });
    await page.route("**/api/clock", async (route) => {
      if (route.request().method() === "POST") {
        postCount += 1;
        await route.fulfill({ status: 500, body: "unexpected" });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clockFixture) });
      }
    });
    await page.goto("/clock");
    await page.getByRole("button", { name: "Clock In" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText("accurate to about 250 m");
    expect(postCount).toBe(0);
  });

  test("blocks clock actions while offline without showing success", async ({ page, context }) => {
    await page.route("**/api/clock", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clockFixture) }));
    await page.goto("/clock");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Offline" }).click({ force: true });
    await expect(page.getByText("Clocked in", { exact: true })).toHaveCount(0);
  });

  test("respects reduced motion and 44-point primary targets", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const targets = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
    for (let index = 0; index < await targets.count(); index += 1) {
      const box = await targets.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    const durations = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    expect(durations).toBe("auto");
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
    await noPageOverflow(page);
  });
});

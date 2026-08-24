import { execFileSync } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { webkit } from "@playwright/test";

const baseUrl = process.env.APP_STORE_SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3000";
const outputRoot = resolve(
  process.env.APP_STORE_SCREENSHOT_DIR ?? "app-store-assets/screenshots",
);

const devices = [
  {
    directory: "iphone-6.9",
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    expected: { width: 1320, height: 2868 },
  },
  {
    directory: "ipad-13",
    viewport: { width: 1032, height: 1376 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    expected: { width: 2064, height: 2752 },
  },
];

const today = new Date();
const businessDateParts = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(today)
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => [type, Number(value)]),
);
const businessDateUtc = Date.UTC(
  businessDateParts.year,
  businessDateParts.month - 1,
  businessDateParts.day,
);
const dateOnly = (offsetDays) => {
  const date = new Date(businessDateUtc + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
};

const homeFixture = {
  profile: {
    id: "app-store-employee",
    name: "Jordan Lee",
    department: "warehouse",
    locationName: "Toronto",
  },
  clock: {
    linked: true,
    open: null,
    week: [
      { date: dateOnly(-4), label: "Wed", minutes: 480, open: false },
      { date: dateOnly(-3), label: "Thu", minutes: 450, open: false },
      { date: dateOnly(-2), label: "Fri", minutes: 465, open: false },
      { date: dateOnly(-1), label: "Sat", minutes: 420, open: false },
    ],
    weekMinutes: 1815,
  },
  tasks: { active: 3, dueToday: 1, overdue: 0 },
  roleActions: [
    {
      id: "warehouse-report",
      label: "Daily report",
      description: "Record today's production",
      href: "/warehouse/report",
    },
    {
      id: "purchasing",
      label: "Purchasing",
      description: "Review inventory and open orders",
      href: "/warehouse/purchasing",
    },
  ],
};

const clockFixture = {
  linked: true,
  employeeName: "Jordan Lee",
  locationName: "Toronto",
  geofenced: true,
  geofenceReady: true,
  open: null,
  week: [
    { date: dateOnly(-4), label: "Wed", minutes: 480, open: false },
    { date: dateOnly(-3), label: "Thu", minutes: 450, open: false },
    { date: dateOnly(-2), label: "Fri", minutes: 465, open: false },
    { date: dateOnly(-1), label: "Sat", minutes: 420, open: false },
  ],
  weekMinutes: 1815,
};

const tasksFixture = [
  {
    id: "task-1",
    title: "Complete the daily production report",
    completed: false,
    created_by: "manager@rftransparent.ca",
    created_by_name: "Operations Manager",
    created_at: new Date(today.getTime() - 86_400_000).toISOString(),
    due_at: dateOnly(0),
  },
  {
    id: "task-2",
    title: "Verify tomorrow's pickup staging area",
    completed: false,
    created_by: "manager@rftransparent.ca",
    created_by_name: "Operations Manager",
    created_at: new Date(today.getTime() - 172_800_000).toISOString(),
    due_at: dateOnly(1),
  },
  {
    id: "task-3",
    title: "Review low-stock hardware list",
    completed: false,
    created_by: "manager@rftransparent.ca",
    created_by_name: "Operations Manager",
    created_at: new Date(today.getTime() - 259_200_000).toISOString(),
    due_at: dateOnly(5),
  },
];

const viewerFixture = {
  email: "app-review@rftransparent.ca",
  name: "Jordan Lee",
  avatarUrl: null,
  preferences: {
    homePage: "auto",
    dashboard: "auto",
    sidebarMode: "expanded",
    canvasTone: "soft",
    motion: "system",
  },
  resolvedHomePage: "/",
  resolvedDashboard: "/",
  isAdmin: false,
  isManagement: false,
};

async function capture(page, path, outputPath) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
  });
  await page.screenshot({
    path: outputPath,
    type: "jpeg",
    quality: 94,
    animations: "disabled",
  });
}

async function verifyDimensions(path, expected) {
  const output = execFileSync(
    "/usr/bin/sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", path],
    { encoding: "utf8" },
  );
  const width = Number.parseInt(output.match(/pixelWidth:\s*(\d+)/)?.[1] ?? "", 10);
  const height = Number.parseInt(output.match(/pixelHeight:\s*(\d+)/)?.[1] ?? "", 10);
  const hasAlpha = output.match(/hasAlpha:\s*(\w+)/)?.[1] ?? "unknown";
  if (width !== expected.width || height !== expected.height) {
    throw new Error(
      `${path} is ${width}x${height}; expected ${expected.width}x${expected.height}.`,
    );
  }
  if (hasAlpha !== "no") throw new Error(`${path} must not contain an alpha channel.`);
}

const browser = await webkit.launch();
try {
  for (const device of devices) {
    const outputDirectory = resolve(outputRoot, device.directory);
    await mkdir(outputDirectory, { recursive: true });

    const context = await browser.newContext({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      userAgent: device.userAgent,
      locale: "en-CA",
      timezoneId: "America/Toronto",
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      window.Capacitor = {
        ...(window.Capacitor ?? {}),
        isNativePlatform: () => true,
      };
    });
    const page = await context.newPage();
    await page.route("**/api/mobile/home", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(homeFixture) }),
    );
    await page.route("**/api/clock", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clockFixture) }),
    );
    await page.route("**/api/todos**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tasksFixture) }),
    );
    // Keep the visible identity consistent with the warehouse fixture. The
    // local owner session exists only to cross the authenticated page guard.
    await page.route("**/api/admin/me", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(viewerFixture) }),
    );
    await page.route("**/api/problems/count", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ open: 0 }) }),
    );

    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    // Use a structural locator so the same handle can restore the control
    // after it has been hidden from the accessibility tree for the screenshot.
    const developerLogin = page.locator("button").filter({ hasText: "Sign in as Fuanne" });
    await developerLogin.evaluate((element) => {
      element.style.display = "none";
    });
    const loginPath = resolve(outputDirectory, "01-sign-in.jpg");
    await page.screenshot({
      path: loginPath,
      type: "jpeg",
      quality: 94,
      animations: "disabled",
    });
    await developerLogin.evaluate((element) => {
      element.style.display = "";
    });
    await developerLogin.click();
    await page.waitForURL(`${baseUrl}/`, { timeout: 30_000 });
    await page.getByRole("heading", { name: /Good (morning|afternoon|evening), Jordan/ }).waitFor();

    const homePath = resolve(outputDirectory, "02-daily-home.jpg");
    await page.screenshot({
      path: homePath,
      type: "jpeg",
      quality: 94,
      animations: "disabled",
    });

    const clockPath = resolve(outputDirectory, "03-clock.jpg");
    await capture(page, "/clock", clockPath);
    await page.getByText("Clocked out", { exact: true }).waitFor();
    await page.screenshot({
      path: clockPath,
      type: "jpeg",
      quality: 94,
      animations: "disabled",
    });

    const tasksPath = resolve(outputDirectory, "04-tasks.jpg");
    await capture(page, "/todos", tasksPath);
    await page.getByText("Complete the daily production report", { exact: true }).waitFor();
    if (device.directory === "iphone-6.9") {
      await page.locator("[data-app-main]").evaluate((element) => {
        element.scrollTo({ top: 520, behavior: "instant" });
      });
    }
    await page.screenshot({
      path: tasksPath,
      type: "jpeg",
      quality: 94,
      animations: "disabled",
    });

    for (const path of [loginPath, homePath, clockPath, tasksPath]) {
      await verifyDimensions(path, device.expected);
    }
    await context.close();
  }

  const files = [];
  for (const device of devices) {
    const directory = resolve(outputRoot, device.directory);
    for (const file of await readdir(directory)) {
      const path = resolve(directory, file);
      const details = await stat(path);
      files.push(`${device.directory}/${file} (${Math.round(details.size / 1024)} KB)`);
    }
  }
  console.log(`Created App Store screenshots:\n${files.join("\n")}`);
} finally {
  await browser.close();
}

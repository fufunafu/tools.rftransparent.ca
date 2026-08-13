// The five dashboards a person can call theirs. Selected from the switcher on
// any dashboard page; "auto" (the default) falls back to the role-derived one.
export const DASHBOARD_OPTIONS = [
  { value: "/", label: "Fuanne's" },
  { value: "/dashboards/sales", label: "Sales Manager" },
  { value: "/dashboards/store/toronto", label: "Toronto Store" },
  { value: "/dashboards/store/montreal", label: "Montreal Store" },
  { value: "/dashboards/marketing", label: "Marketing" },
] as const;

export type DashboardChoice = "auto" | (typeof DASHBOARD_OPTIONS)[number]["value"];

export const HOME_PAGE_OPTIONS = [
  { value: "auto", label: "Automatic", description: "Your dashboard — the one you picked, or your role's default" },
  { value: "/", label: "Main dashboard", description: "Company overview and daily priorities" },
  { value: "/dashboards/sales", label: "Sales Manager", description: "Revenue, quotes, follow-ups, and commissions" },
  { value: "/dashboards/store/toronto", label: "Toronto Store", description: "Toronto sales, calls, and team" },
  { value: "/dashboards/store/montreal", label: "Montreal Store", description: "Montreal sales, calls, and team" },
  { value: "/dashboards/marketing", label: "Marketing", description: "Ad performance at a glance" },
  { value: "/todos", label: "Tasks", description: "Your open tasks and due dates" },
  { value: "/sales", label: "Sales", description: "Store performance and revenue" },
] as const;

export const SIDEBAR_OPTIONS = ["expanded", "compact"] as const;
export const CANVAS_OPTIONS = ["soft", "clean"] as const;
export const MOTION_OPTIONS = ["system", "reduced"] as const;

export type HomePage = (typeof HOME_PAGE_OPTIONS)[number]["value"];
export type SidebarMode = (typeof SIDEBAR_OPTIONS)[number];
export type CanvasTone = (typeof CANVAS_OPTIONS)[number];
export type MotionPreference = (typeof MOTION_OPTIONS)[number];

export interface AccountPreferences {
  homePage: HomePage;
  /** Which dashboard the sidebar's Dashboard entry opens. */
  dashboard: DashboardChoice;
  sidebarMode: SidebarMode;
  canvasTone: CanvasTone;
  motion: MotionPreference;
}

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  // "auto" resolves to the viewer's role dashboard via resolveLandingPage()
  // (default-dashboard.ts). It is a sentinel, not a path — anything that puts
  // homePage in an href or redirect must resolve it first.
  homePage: "auto",
  dashboard: "auto",
  sidebarMode: "expanded",
  canvasTone: "soft",
  motion: "system",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function sanitizeAccountPreferences(value: unknown): AccountPreferences {
  if (!isRecord(value)) return { ...DEFAULT_ACCOUNT_PREFERENCES };

  const homePages = HOME_PAGE_OPTIONS.map((option) => option.value);
  const dashboards: DashboardChoice[] = ["auto", ...DASHBOARD_OPTIONS.map((option) => option.value)];

  return {
    homePage: includes(homePages, value.homePage)
      ? value.homePage
      : DEFAULT_ACCOUNT_PREFERENCES.homePage,
    dashboard: includes(dashboards, value.dashboard)
      ? value.dashboard
      : DEFAULT_ACCOUNT_PREFERENCES.dashboard,
    sidebarMode: includes(SIDEBAR_OPTIONS, value.sidebarMode)
      ? value.sidebarMode
      : DEFAULT_ACCOUNT_PREFERENCES.sidebarMode,
    canvasTone: includes(CANVAS_OPTIONS, value.canvasTone)
      ? value.canvasTone
      : DEFAULT_ACCOUNT_PREFERENCES.canvasTone,
    motion: includes(MOTION_OPTIONS, value.motion)
      ? value.motion
      : DEFAULT_ACCOUNT_PREFERENCES.motion,
  };
}

export function getAccountPreferences(metadata: unknown): AccountPreferences {
  if (!isRecord(metadata)) return { ...DEFAULT_ACCOUNT_PREFERENCES };
  return sanitizeAccountPreferences(metadata.rf_preferences);
}

export function getPreferredName(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;

  for (const key of ["display_name", "full_name", "name"] as const) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }

  return null;
}

export function getCustomDisplayName(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const value = metadata.display_name;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

export function applyAccountPreferences(preferences: AccountPreferences): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.canvas = preferences.canvasTone;
  document.documentElement.dataset.motion = preferences.motion;
}

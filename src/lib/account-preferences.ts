export const HOME_PAGE_OPTIONS = [
  { value: "/", label: "Dashboard", description: "Company overview and daily priorities" },
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
  sidebarMode: SidebarMode;
  canvasTone: CanvasTone;
  motion: MotionPreference;
}

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  homePage: "/",
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

  return {
    homePage: includes(homePages, value.homePage)
      ? value.homePage
      : DEFAULT_ACCOUNT_PREFERENCES.homePage,
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

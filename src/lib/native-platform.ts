export type NativePlatform = "ios" | "android";

export function getNativePlatform(): NativePlatform {
  if (typeof window === "undefined") return "ios";
  const capacitor = (window as Window & {
    Capacitor?: { getPlatform?: () => string };
  }).Capacitor;
  return capacitor?.getPlatform?.() === "android" ? "android" : "ios";
}

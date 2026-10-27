export function isDemoWorkspace(): boolean {
  return process.env.RF_REVIEW_DEMO === "1";
}


export function demoDataConfiguration(): { url: string; key: string } {
  const url = process.env.RF_REVIEW_DATA_URL?.trim();
  const key = process.env.RF_REVIEW_DATA_KEY?.trim();
  if (!url || !key || !process.env.RF_REVIEW_DATA_PROJECT || new URL(url).hostname !== `${process.env.RF_REVIEW_DATA_PROJECT}.supabase.co`) {
    throw new Error("The demo workspace requires a separate sample-data project.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co") || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/") {
    throw new Error("Invalid demo data project URL.");
  }
  return { url, key };
}

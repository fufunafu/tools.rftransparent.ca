import { fetchWithRetry } from "@/lib/fetch-retry";

const GA4_API_URL = "https://analyticsdata.googleapis.com/v1beta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let gaTokenCache: { token: string; expiresAt: number } | null = null;

async function getGAAccessToken(): Promise<string> {
  if (gaTokenCache && Date.now() < gaTokenCache.expiresAt) {
    return gaTokenCache.token;
  }

  // Reuse the same Google OAuth credentials as Google Ads
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 OAuth token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  gaTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

export function isGA4Configured(): boolean {
  return !!(
    process.env.GOOGLE_GA4_PROPERTY_ID &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

export interface DailySessions {
  date: string;
  sessions: number;
}

export async function getDailySessions(
  startDate: string,
  endDate: string
): Promise<DailySessions[]> {
  const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID;
  if (!propertyId) throw new Error("GA4 property ID not configured");

  const token = await getGAAccessToken();

  const res = await fetchWithRetry(
    `${GA4_API_URL}/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const rows: DailySessions[] = [];

  for (const row of json.rows ?? []) {
    const rawDate = row.dimensionValues?.[0]?.value; // "20260311"
    if (!rawDate) continue;
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const sessions = parseInt(row.metricValues?.[0]?.value ?? "0", 10);
    rows.push({ date, sessions });
  }

  return rows;
}

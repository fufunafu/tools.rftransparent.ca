const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_API_URL = "https://googleads.googleapis.com/v20";

let accessTokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (accessTokenCache && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  const res = await fetch(TOKEN_URL, {
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
    throw new Error(`Google OAuth token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryGoogleAds(gaql: string): Promise<any[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!customerId || !developerToken) {
    throw new Error("Google Ads credentials not configured");
  }

  const token = await getAccessToken();

  const res = await fetch(
    `${ADS_API_URL}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "developer-token": developerToken,
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: gaql }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const rows: unknown[] = [];
  for (const batch of json) {
    for (const row of (batch as { results?: unknown[] }).results ?? []) {
      rows.push(row);
    }
  }
  return rows;
}

interface RawMetrics {
  costMicros?: string;
  clicks?: string;
  impressions?: string;
  conversions?: number;
  conversionsValue?: number;
}

function parseMetrics(m: RawMetrics) {
  const costMicros = parseInt(m.costMicros ?? "0", 10);
  const clicks = parseInt(m.clicks ?? "0", 10);
  const impressions = parseInt(m.impressions ?? "0", 10);
  const conversions = m.conversions ?? 0;
  const value = m.conversionsValue ?? 0;
  return { costMicros, clicks, impressions, conversions, value };
}

function buildAdMetrics(agg: { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }) {
  const adSpend = agg.costMicros / 1_000_000;
  return {
    ad_spend: Math.round(adSpend * 100) / 100,
    clicks: agg.clicks,
    impressions: agg.impressions,
    conversions: Math.round(agg.conversions * 100) / 100,
    revenue: Math.round(agg.value * 100) / 100,
    roas: adSpend > 0 ? Math.round((agg.value / adSpend) * 100) / 100 : 0,
  };
}

export interface AdMetrics {
  ad_spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  revenue: number;
  roas: number;
}

export type Market = "all" | "us" | "ca";

const US_STATES = [
  "California", "Texas", "Florida", "Georgia", "Arizona",
  "Michigan", "Washington", "New York", "New V2",
];

export function classifyCampaignCountry(name: string): "us" | "ca" | "both" | null {
  if (/\bUS\/CA\b/.test(name)) return "both";
  if (/\bUSA\b/.test(name) || US_STATES.some((s) => name.includes(s))) return "us";
  // Match " CA" at word boundary but not "California"
  if (/\bCA\b/.test(name) && !name.includes("California")) return "ca";
  if (name.includes("Ontario")) return "ca";
  return null;
}

function matchesMarket(campaignName: string, market: Market): boolean {
  if (market === "all") return true;
  const country = classifyCampaignCountry(campaignName);
  if (country === null) return false; // unclassified campaigns only in "all"
  if (country === "both") return true;
  return country === market;
}

export async function getAdMetrics(startDate: string, endDate: string, market: Market = "all"): Promise<AdMetrics> {
  const rows = await queryGoogleAds(`
    SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `);

  const agg = { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
  for (const row of rows) {
    const r = row as { campaign: { name: string }; metrics: RawMetrics };
    if (!matchesMarket(r.campaign.name, market)) continue;
    const m = parseMetrics(r.metrics);
    agg.costMicros += m.costMicros;
    agg.clicks += m.clicks;
    agg.impressions += m.impressions;
    agg.conversions += m.conversions;
    agg.value += m.value;
  }

  return buildAdMetrics(agg);
}

export interface DailyAdMetrics extends AdMetrics {
  date: string;
}

export async function getDailyAdMetrics(startDate: string, endDate: string, market: Market = "all"): Promise<DailyAdMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks,
           metrics.impressions, metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `);

  const byDate = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { campaign: { name: string }; segments: { date: string }; metrics: RawMetrics };
    if (!matchesMarket(r.campaign.name, market)) continue;
    const d = r.segments.date;
    const m = parseMetrics(r.metrics);
    const existing = byDate.get(d) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byDate.set(d, existing);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({ date, ...buildAdMetrics(agg) }));
}

// --- Campaign Breakdown ---
export interface CampaignMetrics extends AdMetrics {
  campaign: string;
}

export async function getCampaignBreakdown(startDate: string, endDate: string, market: Market = "all"): Promise<CampaignMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT campaign.name, metrics.cost_micros, metrics.clicks,
           metrics.impressions, metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `);

  const byCampaign = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { campaign: { name: string }; metrics: RawMetrics };
    const name = r.campaign.name;
    if (!matchesMarket(name, market)) continue;
    const m = parseMetrics(r.metrics);
    const existing = byCampaign.get(name) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byCampaign.set(name, existing);
  }

  return Array.from(byCampaign.entries())
    .map(([campaign, agg]) => ({ campaign, ...buildAdMetrics(agg) }))
    .sort((a, b) => b.ad_spend - a.ad_spend);
}

// --- Device Breakdown ---
export interface DeviceMetrics extends AdMetrics {
  device: string;
}

export async function getDeviceBreakdown(startDate: string, endDate: string): Promise<DeviceMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT segments.device, metrics.cost_micros, metrics.clicks,
           metrics.impressions, metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `);

  const byDevice = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { segments: { device: string }; metrics: RawMetrics };
    const device = r.segments.device;
    const m = parseMetrics(r.metrics);
    const existing = byDevice.get(device) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byDevice.set(device, existing);
  }

  const deviceLabels: Record<string, string> = {
    MOBILE: "Mobile",
    DESKTOP: "Desktop",
    TABLET: "Tablet",
    CONNECTED_TV: "Connected TV",
    OTHER: "Other",
  };

  return Array.from(byDevice.entries())
    .map(([device, agg]) => ({ device: deviceLabels[device] ?? device, ...buildAdMetrics(agg) }))
    .sort((a, b) => b.ad_spend - a.ad_spend);
}

// --- Geographic Performance ---
export interface GeoMetrics extends AdMetrics {
  country: string;
  criterionId: string;
}

const COUNTRY_NAMES: Record<string, string> = {
  "2840": "United States", "2124": "Canada", "2826": "United Kingdom",
  "2036": "Australia", "2276": "Germany", "2250": "France",
  "2356": "India", "2076": "Brazil", "2484": "Mexico",
  "2392": "Japan", "2410": "South Korea", "2380": "Italy",
  "2724": "Spain", "2528": "Netherlands", "2756": "Switzerland",
  "2752": "Sweden", "2578": "Norway", "2208": "Denmark",
  "2246": "Finland", "2040": "Austria", "2056": "Belgium",
  "2554": "New Zealand", "2702": "Singapore", "2344": "Hong Kong",
  "2158": "Taiwan", "2608": "Philippines", "2764": "Thailand",
  "2360": "Indonesia", "2458": "Malaysia", "2704": "Vietnam",
  "2032": "Argentina", "2170": "Colombia", "2152": "Chile",
  "2616": "Poland", "2203": "Czech Republic", "2348": "Hungary",
  "2642": "Romania", "2792": "Turkey", "2818": "Egypt",
  "2710": "South Africa", "2566": "Nigeria", "2784": "UAE",
  "2682": "Saudi Arabia", "2376": "Israel",
};

export async function getGeoPerformance(startDate: string, endDate: string): Promise<GeoMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT geographic_view.country_criterion_id,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM geographic_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  const byGeo = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { geographicView: { countryCriterionId: string }; metrics: RawMetrics };
    const id = r.geographicView.countryCriterionId;
    const m = parseMetrics(r.metrics);
    const existing = byGeo.get(id) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byGeo.set(id, existing);
  }

  return Array.from(byGeo.entries())
    .map(([criterionId, agg]) => ({
      criterionId,
      country: COUNTRY_NAMES[criterionId] ?? `Region ${criterionId}`,
      ...buildAdMetrics(agg),
    }))
    .sort((a, b) => b.ad_spend - a.ad_spend);
}

// --- Search Terms ---
export interface SearchTermMetrics extends AdMetrics {
  term: string;
}

export async function getSearchTerms(startDate: string, endDate: string): Promise<SearchTermMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT search_term_view.search_term,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM search_term_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  const byTerm = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { searchTermView: { searchTerm: string }; metrics: RawMetrics };
    const term = r.searchTermView.searchTerm;
    const m = parseMetrics(r.metrics);
    const existing = byTerm.get(term) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byTerm.set(term, existing);
  }

  return Array.from(byTerm.entries())
    .map(([term, agg]) => ({ term, ...buildAdMetrics(agg) }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 100);
}

// --- Region (State/Province) Performance ---
export interface RegionMetrics extends AdMetrics {
  criterionId: string;
  region: string;
}

// US state criterion IDs verified from Google Ads API
const GEO_NAMES: Record<string, string> = {
  "21132": "Alaska", "21133": "Alabama", "21135": "Arkansas", "21136": "Arizona",
  "21137": "California", "21138": "Colorado", "21139": "Connecticut",
  "21140": "District of Columbia", "21141": "Delaware", "21142": "Florida",
  "21143": "Georgia", "21144": "Hawaii", "21145": "Iowa", "21146": "Idaho",
  "21147": "Illinois", "21148": "Indiana", "21149": "Kansas", "21150": "Kentucky",
  "21151": "Louisiana", "21152": "Massachusetts", "21153": "Maryland", "21154": "Maine",
  "21155": "Michigan", "21156": "Minnesota", "21157": "Missouri", "21158": "Mississippi",
  "21159": "Montana", "21160": "North Carolina", "21161": "North Dakota", "21162": "Nebraska",
  "21163": "New Hampshire", "21164": "New Jersey", "21165": "New Mexico", "21166": "Nevada",
  "21167": "New York", "21168": "Ohio", "21169": "Oklahoma", "21170": "Oregon",
  "21171": "Pennsylvania", "21172": "Rhode Island", "21173": "South Carolina",
  "21174": "South Dakota", "21175": "Tennessee", "21176": "Texas", "21177": "Utah",
  "21178": "Virginia", "21179": "Vermont", "21180": "Washington", "21182": "Wisconsin",
  // Metro areas
  "9073451": "San Francisco Bay Area", "9073452": "Silicon Valley",
};

export async function getRegionPerformance(
  startDate: string,
  endDate: string,
  countryCriterionId: string,
): Promise<{ regions: RegionMetrics[] }> {
  const rows = await queryGoogleAds(`
    SELECT geographic_view.country_criterion_id,
           segments.geo_target_region,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM geographic_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND geographic_view.country_criterion_id = ${countryCriterionId}
      AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
  `);

  // Aggregate by region
  const byRegion = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { segments: { geoTargetRegion: string }; metrics: RawMetrics };
    const regionRef = String(r.segments.geoTargetRegion ?? "").replace("geoTargetConstants/", "");
    if (!regionRef) continue;
    const m = parseMetrics(r.metrics);
    const existing = byRegion.get(regionRef) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byRegion.set(regionRef, existing);
  }

  if (byRegion.size === 0) return { regions: [] };

  // Resolve names — use hardcoded map first, API for unknowns
  const regionIds = Array.from(byRegion.keys());
  const unknownIds = regionIds.filter((id) => !GEO_NAMES[id]);
  const apiGeoInfo = unknownIds.length > 0 ? await resolveGeoInfo(unknownIds) : {};

  const regions: RegionMetrics[] = [];
  for (const [regionId, agg] of byRegion.entries()) {
    const name = GEO_NAMES[regionId] ?? apiGeoInfo[regionId]?.name ?? `Region ${regionId}`;
    regions.push({
      criterionId: regionId,
      region: name,
      ...buildAdMetrics(agg),
    });
  }

  return { regions: regions.sort((a, b) => b.ad_spend - a.ad_spend) };
}

// --- City Performance ---
export interface CityMetrics extends AdMetrics {
  criterionId: string;
  city: string;
}

interface GeoInfo {
  name: string;
  targetType: string;
  canonicalName: string;
}

async function resolveGeoInfo(criterionIds: string[]): Promise<Record<string, GeoInfo>> {
  if (criterionIds.length === 0) return {};

  const result: Record<string, GeoInfo> = {};
  // Query each geo_target_constant individually (batch OR queries return empty)
  const fetches = criterionIds.map(async (id) => {
    try {
      const rows = await queryGoogleAds(`
        SELECT geo_target_constant.id, geo_target_constant.name,
               geo_target_constant.canonical_name, geo_target_constant.target_type
        FROM geo_target_constant
        WHERE geo_target_constant.id = ${id}
        LIMIT 1
      `);
      const r = rows[0] as {
        geoTargetConstant: { id: string; name: string; canonicalName: string; targetType: string };
      } | undefined;
      if (r) {
        result[id] = {
          name: r.geoTargetConstant.name,
          targetType: r.geoTargetConstant.targetType,
          canonicalName: r.geoTargetConstant.canonicalName,
        };
      }
    } catch {
      // silently skip unresolvable IDs
    }
  });
  await Promise.all(fetches);
  return result;
}

export async function getCityPerformance(
  startDate: string,
  endDate: string,
  countryCriterionId: string,
): Promise<CityMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT geographic_view.country_criterion_id,
           segments.geo_target_city,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM geographic_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND geographic_view.country_criterion_id = ${countryCriterionId}
      AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
  `);

  // Aggregate by city
  const byCity = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { segments: { geoTargetCity: string }; metrics: RawMetrics };
    const cityRef = String(r.segments.geoTargetCity ?? "").replace("geoTargetConstants/", "");
    if (!cityRef) continue;
    const m = parseMetrics(r.metrics);
    const existing = byCity.get(cityRef) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byCity.set(cityRef, existing);
  }

  // Sort by spend, take top 50, resolve names
  const sorted = Array.from(byCity.entries())
    .sort(([, a], [, b]) => b.costMicros - a.costMicros)
    .slice(0, 50);

  const geoInfo = await resolveGeoInfo(sorted.map(([id]) => id));

  return sorted
    .slice(0, 30)
    .map(([criterionId, agg]) => ({
      criterionId,
      city: geoInfo[criterionId]?.name ?? `City ${criterionId}`,
      ...buildAdMetrics(agg),
    }));
}

// --- Age Demographics ---
export interface AgeMetrics extends AdMetrics {
  ageRange: string;
}

const AGE_LABELS: Record<string, string> = {
  AGE_RANGE_18_24: "18-24",
  AGE_RANGE_25_34: "25-34",
  AGE_RANGE_35_44: "35-44",
  AGE_RANGE_45_54: "45-54",
  AGE_RANGE_55_64: "55-64",
  AGE_RANGE_65_UP: "65+",
  AGE_RANGE_UNDETERMINED: "Unknown",
};

export async function getAgePerformance(startDate: string, endDate: string): Promise<AgeMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT ad_group_criterion.age_range.type,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM age_range_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  const byAge = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { adGroupCriterion: { ageRange: { type: string } }; metrics: RawMetrics };
    const age = r.adGroupCriterion.ageRange.type;
    const m = parseMetrics(r.metrics);
    const existing = byAge.get(age) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byAge.set(age, existing);
  }

  return Array.from(byAge.entries())
    .map(([type, agg]) => ({
      ageRange: AGE_LABELS[type] ?? type,
      ...buildAdMetrics(agg),
    }))
    .sort((a, b) => {
      const order = Object.values(AGE_LABELS);
      return order.indexOf(a.ageRange) - order.indexOf(b.ageRange);
    });
}

// --- Gender Demographics ---
export interface GenderMetrics extends AdMetrics {
  gender: string;
}

const GENDER_LABELS: Record<string, string> = {
  MALE: "Male",
  FEMALE: "Female",
  UNDETERMINED: "Unknown",
};

export async function getGenderPerformance(startDate: string, endDate: string): Promise<GenderMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT ad_group_criterion.gender.type,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM gender_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  const byGender = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { adGroupCriterion: { gender: { type: string } }; metrics: RawMetrics };
    const gender = r.adGroupCriterion.gender.type;
    const m = parseMetrics(r.metrics);
    const existing = byGender.get(gender) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byGender.set(gender, existing);
  }

  return Array.from(byGender.entries())
    .map(([type, agg]) => ({
      gender: GENDER_LABELS[type] ?? type,
      ...buildAdMetrics(agg),
    }))
    .sort((a, b) => b.ad_spend - a.ad_spend);
}

// --- Language Performance ---
export interface LanguageMetrics extends AdMetrics {
  language: string;
}

export async function getLanguagePerformance(startDate: string, endDate: string): Promise<LanguageMetrics[]> {
  const rows = await queryGoogleAds(`
    SELECT campaign_criterion.language.language_constant,
           metrics.cost_micros, metrics.clicks, metrics.impressions,
           metrics.conversions, metrics.conversions_value
    FROM campaign_criterion
    WHERE campaign_criterion.type = 'LANGUAGE'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
  `);

  const byLang = new Map<string, { costMicros: number; clicks: number; impressions: number; conversions: number; value: number }>();
  for (const row of rows) {
    const r = row as { campaignCriterion: { language: { languageConstant: string } }; metrics: RawMetrics };
    const langConstant = r.campaignCriterion.language.languageConstant ?? "unknown";
    const m = parseMetrics(r.metrics);
    const existing = byLang.get(langConstant) ?? { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
    existing.costMicros += m.costMicros;
    existing.clicks += m.clicks;
    existing.impressions += m.impressions;
    existing.conversions += m.conversions;
    existing.value += m.value;
    byLang.set(langConstant, existing);
  }

  const LANG_NAMES: Record<string, string> = {
    "languageConstants/1000": "English",
    "languageConstants/1003": "Spanish",
    "languageConstants/1002": "French",
    "languageConstants/1004": "Portuguese",
    "languageConstants/1001": "German",
    "languageConstants/1005": "Italian",
    "languageConstants/1009": "Chinese (Simplified)",
    "languageConstants/1017": "Japanese",
    "languageConstants/1012": "Korean",
    "languageConstants/1019": "Arabic",
    "languageConstants/1020": "Hindi",
    "languageConstants/1010": "Dutch",
    "languageConstants/1015": "Polish",
    "languageConstants/1014": "Russian",
    "languageConstants/1042": "Turkish",
  };

  return Array.from(byLang.entries())
    .map(([langConstant, agg]) => ({
      language: LANG_NAMES[langConstant] ?? langConstant.replace("languageConstants/", "Lang "),
      ...buildAdMetrics(agg),
    }))
    .sort((a, b) => b.ad_spend - a.ad_spend);
}

export function isGoogleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );
}

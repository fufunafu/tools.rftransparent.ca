import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import {
  getAdMetrics,
  getDailyAdMetrics,
  getCampaignBreakdown,
  getDeviceBreakdown,
  getGeoPerformance,
  getRegionPerformance,
  getCityPerformance,
  getAgePerformance,
  getGenderPerformance,
  getLanguagePerformance,
  getSearchTerms,
  isGoogleAdsConfigured,
  type Market,
} from "@/lib/google-ads";
import { shopifyGraphQL, REVENUE_FIELDS, calcNetRevenue, type RevenueFields } from "@/lib/shopify";
import { isGA4Configured, getDailySessions } from "@/lib/google-analytics";

const ADS_STORE_ID = "store2"; // Glass Railing Store — the ad-driven store

interface OrderNode extends RevenueFields {
  createdAt: string;
  shippingAddress: { countryCode: string; province: string | null } | null;
}

interface OrdersPage {
  orders: {
    edges: { node: OrderNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

async function fetchAllOrders(startDate: string, endDate: string): Promise<OrderNode[]> {
  const allNodes: OrderNode[] = [];
  let cursor: string | null = null;

  for (;;) {
    const afterClause: string = cursor ? `, after: "${cursor}"` : "";
    const data: OrdersPage = await shopifyGraphQL<OrdersPage>(
      ADS_STORE_ID,
      `query {
        orders(first: 250${afterClause}, query: "created_at:>='${startDate}' AND created_at:<='${endDate}'") {
          edges { cursor node { createdAt ${REVENUE_FIELDS} shippingAddress { countryCode province } } }
          pageInfo { hasNextPage }
        }
      }`
    );

    for (const edge of data.orders.edges) {
      allNodes.push(edge.node);
      cursor = edge.cursor;
    }

    if (!data.orders.pageInfo.hasNextPage || data.orders.edges.length === 0) break;
  }

  return allNodes;
}

const MARKET_COUNTRY_CODES: Record<string, string> = { us: "US", ca: "CA" };

function filterOrdersByMarket(orders: OrderNode[], market: Market): OrderNode[] {
  if (market === "all") return orders;
  const code = MARKET_COUNTRY_CODES[market];
  return orders.filter((o) => o.shippingAddress?.countryCode === code);
}

async function getShopifyStats(startDate: string, endDate: string, market: Market = "all"): Promise<{ revenue: number; orders: number }> {
  const allOrders = await fetchAllOrders(startDate, endDate);
  const orders = filterOrdersByMarket(allOrders, market);
  const revenue = orders.reduce((sum, o) => sum + calcNetRevenue(o), 0);
  return { revenue, orders: orders.length };
}

async function getDailyShopifyStats(
  startDate: string,
  endDate: string,
  market: Market = "all"
): Promise<Map<string, { revenue: number; orders: number }>> {
  const allOrders = await fetchAllOrders(startDate, endDate);
  const orders = filterOrdersByMarket(allOrders, market);
  const byDate = new Map<string, { revenue: number; orders: number }>();
  for (const node of orders) {
    const d = node.createdAt.split("T")[0];
    const existing = byDate.get(d) ?? { revenue: 0, orders: 0 };
    existing.revenue += calcNetRevenue(node);
    existing.orders += 1;
    byDate.set(d, existing);
  }
  return byDate;
}

// Map Shopify country codes to Google Ads criterion IDs
const COUNTRY_CODE_TO_CRITERION: Record<string, string> = {
  US: "2840", CA: "2124", GB: "2826", AU: "2036", DE: "2276", FR: "2250",
  IN: "2356", BR: "2076", MX: "2484", JP: "2392", KR: "2410", IT: "2380",
  ES: "2724", NL: "2528", CH: "2756", SE: "2752", NO: "2578", DK: "2208",
  FI: "2246", AT: "2040", BE: "2056", NZ: "2554", SG: "2702", HK: "2344",
  TW: "2158", PH: "2608", TH: "2764", ID: "2360", MY: "2458", VN: "2704",
};

interface ShopifyGeoData {
  byCountry: Map<string, { revenue: number; orders: number }>; // keyed by criterion ID
  byProvince: Map<string, { revenue: number; orders: number }>; // keyed by province name
}

async function getShopifyGeoBreakdown(startDate: string, endDate: string): Promise<ShopifyGeoData> {
  const allOrders = await fetchAllOrders(startDate, endDate);
  const byCountry = new Map<string, { revenue: number; orders: number }>();
  const byProvince = new Map<string, { revenue: number; orders: number }>();

  for (const order of allOrders) {
    const amount = calcNetRevenue(order);
    const cc = order.shippingAddress?.countryCode;
    if (!cc) continue;

    const criterionId = COUNTRY_CODE_TO_CRITERION[cc] ?? cc;
    const existing = byCountry.get(criterionId) ?? { revenue: 0, orders: 0 };
    existing.revenue += amount;
    existing.orders += 1;
    byCountry.set(criterionId, existing);

    const province = order.shippingAddress?.province;
    if (province) {
      const prov = byProvince.get(province) ?? { revenue: 0, orders: 0 };
      prov.revenue += amount;
      prov.orders += 1;
      byProvince.set(province, prov);
    }
  }

  return { byCountry, byProvince };
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function generateDemoData(days: number) {
  const multiplier = Math.max(1, days);
  const base = {
    ad_spend: Math.round(120 * multiplier),
    clicks: Math.round(85 * multiplier),
    impressions: Math.round(4200 * multiplier),
    conversions: Math.round(12 * multiplier),
    revenue: Math.round(384 * multiplier),
    roas: 3.2,
    order_count: Math.round(8 * multiplier),
  };
  const prev = {
    ad_spend: Math.round(135 * multiplier),
    clicks: Math.round(72 * multiplier),
    impressions: Math.round(3800 * multiplier),
    conversions: Math.round(10 * multiplier),
    revenue: Math.round(378 * multiplier),
    roas: 2.8,
    order_count: Math.round(7 * multiplier),
  };
  return { current: base, previous: prev };
}

function generateDemoHistory(from: string, to: string) {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const history = [];
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dayOfWeek = d.getDay();
    const weekendDip = dayOfWeek === 0 || dayOfWeek === 6 ? 0.6 : 1;
    const trend = 1 + i * 0.008;
    const noise = 0.85 + Math.random() * 0.3;
    const factor = weekendDip * trend * noise;
    const adSpend = Math.round(120 * factor);
    const revenue = Math.round(384 * factor * (0.9 + Math.random() * 0.2));
    const orderCount = Math.max(1, Math.round(8 * factor * (0.8 + Math.random() * 0.4)));
    history.push({
      date: toDateStr(d),
      ad_spend: adSpend,
      clicks: Math.round(85 * factor),
      impressions: Math.round(4200 * factor),
      conversions: Math.round(12 * factor),
      revenue,
      roas: adSpend > 0 ? Math.round((revenue / adSpend) * 100) / 100 : 0,
      order_count: orderCount,
    });
  }
  return history;
}

function generateDemoCampaigns() {
  const campaigns = [
    { name: "Glass Railing - Search", spendMult: 1, perfMult: 1.2 },
    { name: "Glass Railing - Display", spendMult: 0.6, perfMult: 0.7 },
    { name: "Deck Railing - Search", spendMult: 0.8, perfMult: 1.0 },
    { name: "Frameless Glass - PMax", spendMult: 0.4, perfMult: 1.5 },
  ];
  return campaigns.map((c) => {
    const spend = Math.round(2400 * c.spendMult);
    const clicks = Math.round(1700 * c.spendMult * (0.9 + Math.random() * 0.2));
    const impressions = Math.round(85000 * c.spendMult);
    const conversions = Math.round(240 * c.spendMult * c.perfMult);
    const revenue = Math.round(spend * 3.2 * c.perfMult);
    return {
      campaign: c.name,
      ad_spend: spend,
      clicks,
      impressions,
      conversions,
      revenue,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    };
  });
}

function generateDemoDevices() {
  return [
    { device: "Mobile", ad_spend: 1800, clicks: 2400, impressions: 120000, conversions: 180, revenue: 5800, roas: 3.22 },
    { device: "Desktop", ad_spend: 2200, clicks: 1800, impressions: 90000, conversions: 280, revenue: 8400, roas: 3.82 },
    { device: "Tablet", ad_spend: 400, clicks: 320, impressions: 18000, conversions: 40, revenue: 1200, roas: 3.0 },
  ];
}

function generateDemoGeo() {
  return [
    { criterionId: "2840", country: "United States", ad_spend: 3200, clicks: 3800, impressions: 180000, conversions: 420, revenue: 12800, roas: 4.0 },
    { criterionId: "2124", country: "Canada", ad_spend: 800, clicks: 640, impressions: 35000, conversions: 60, revenue: 2100, roas: 2.63 },
    { criterionId: "2826", country: "United Kingdom", ad_spend: 200, clicks: 120, impressions: 8000, conversions: 12, revenue: 480, roas: 2.4 },
    { criterionId: "2036", country: "Australia", ad_spend: 150, clicks: 90, impressions: 5000, conversions: 8, revenue: 320, roas: 2.13 },
  ];
}

function generateDemoSearchTerms() {
  const terms = [
    "glass railing", "frameless glass railing", "glass deck railing",
    "glass railing cost", "glass railing installation", "tempered glass railing",
    "modern glass railing", "exterior glass railing", "balcony glass railing",
    "glass railing panels", "glass railing near me", "glass railing price per foot",
    "cable railing vs glass", "glass railing code requirements", "glass railing hardware",
  ];
  return terms.map((term, i) => {
    const base = 1 - i * 0.05;
    const clicks = Math.max(5, Math.round(320 * base * (0.8 + Math.random() * 0.4)));
    const impressions = Math.round(clicks * (12 + Math.random() * 8));
    const spend = Math.round(clicks * (1.2 + Math.random() * 0.8) * 100) / 100;
    const conversions = Math.max(0, Math.round(clicks * 0.08 * (0.5 + Math.random())));
    const revenue = Math.round(conversions * (180 + Math.random() * 120));
    return {
      term,
      ad_spend: spend,
      clicks,
      impressions,
      conversions,
      revenue,
      roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    };
  }).sort((a, b) => b.clicks - a.clicks);
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view");
  const demo = req.nextUrl.searchParams.get("demo") === "true";
  const market = (req.nextUrl.searchParams.get("market") || "all") as Market;

  // Parse from/to date range
  const today = toDateStr(new Date());
  const from = req.nextUrl.searchParams.get("from") || today;
  const to = req.nextUrl.searchParams.get("to") || today;
  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);

  // Calculate previous period (same length, immediately before)
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - rangeDays);
  const prevFromStr = toDateStr(prevFrom);
  const prevToStr = toDateStr(prevTo);

  const pctChange = (cur: number, prev: number) =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  // --- Campaigns endpoint ---
  if (view === "campaigns") {
    if (demo) return NextResponse.json({ campaigns: generateDemoCampaigns(), demo: true });
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const campaigns = await getCampaignBreakdown(from, to, market);
      return NextResponse.json({ campaigns });
    } catch (err) {
      console.error("[Marketing Campaigns API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch campaigns" },
        { status: 500 }
      );
    }
  }

  // --- Devices endpoint ---
  if (view === "devices") {
    if (demo) return NextResponse.json({ devices: generateDemoDevices(), demo: true });
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const devices = await getDeviceBreakdown(from, to);
      return NextResponse.json({ devices });
    } catch (err) {
      console.error("[Marketing Devices API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch device data" },
        { status: 500 }
      );
    }
  }

  // --- Geo endpoint ---
  if (view === "geo") {
    if (demo) return NextResponse.json({ geo: generateDemoGeo(), demo: true });
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const [adsGeo, shopifyGeo] = await Promise.all([
        getGeoPerformance(from, to),
        getShopifyGeoBreakdown(from, to).catch(() => ({ byCountry: new Map(), byProvince: new Map() })),
      ]);
      const geo = adsGeo.map((g) => {
        const shopify = shopifyGeo.byCountry.get(g.criterionId);
        return {
          ...g,
          shopify_revenue: Math.round((shopify?.revenue ?? 0) * 100) / 100,
          shopify_orders: shopify?.orders ?? 0,
        };
      });
      return NextResponse.json({ geo });
    } catch (err) {
      console.error("[Marketing Geo API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch geo data" },
        { status: 500 }
      );
    }
  }

  // --- Regions endpoint ---
  if (view === "regions") {
    const country = req.nextUrl.searchParams.get("country") || "2840";
    if (demo) {
      const demoRegions = [
        { criterionId: "21133", region: "California", ad_spend: 1800, clicks: 2200, impressions: 95000, conversions: 180, revenue: 6200, roas: 3.44 },
        { criterionId: "21177", region: "Texas", ad_spend: 1200, clicks: 1400, impressions: 62000, conversions: 120, revenue: 4100, roas: 3.42 },
        { criterionId: "21142", region: "Florida", ad_spend: 950, clicks: 1100, impressions: 48000, conversions: 90, revenue: 3200, roas: 3.37 },
        { criterionId: "21167", region: "New York", ad_spend: 800, clicks: 900, impressions: 41000, conversions: 75, revenue: 2700, roas: 3.38 },
        { criterionId: "21147", region: "Illinois", ad_spend: 500, clicks: 580, impressions: 25000, conversions: 45, revenue: 1600, roas: 3.2 },
      ];
      return NextResponse.json({ regions: demoRegions, demo: true });
    }
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const [{ regions }, shopifyGeo] = await Promise.all([
        getRegionPerformance(from, to, country),
        getShopifyGeoBreakdown(from, to).catch(() => ({ byCountry: new Map(), byProvince: new Map() })),
      ]);
      const merged = regions.map((r) => {
        const shopify = shopifyGeo.byProvince.get(r.region);
        return {
          ...r,
          shopify_revenue: Math.round((shopify?.revenue ?? 0) * 100) / 100,
          shopify_orders: shopify?.orders ?? 0,
        };
      });
      return NextResponse.json({ regions: merged });
    } catch (err) {
      console.error("[Marketing Regions API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch region data" },
        { status: 500 }
      );
    }
  }

  // --- Cities endpoint ---
  if (view === "cities") {
    const country = req.nextUrl.searchParams.get("country") || "2840";
    if (demo) {
      const demoCities = [
        { criterionId: "1014221", city: "Los Angeles", ad_spend: 450, clicks: 520, impressions: 22000, conversions: 42, revenue: 1500, roas: 3.33 },
        { criterionId: "1014195", city: "New York", ad_spend: 380, clicks: 440, impressions: 19000, conversions: 35, revenue: 1300, roas: 3.42 },
        { criterionId: "1014129", city: "Houston", ad_spend: 320, clicks: 370, impressions: 16000, conversions: 28, revenue: 1050, roas: 3.28 },
        { criterionId: "1014087", city: "Miami", ad_spend: 280, clicks: 310, impressions: 14000, conversions: 24, revenue: 920, roas: 3.29 },
        { criterionId: "1014212", city: "Chicago", ad_spend: 240, clicks: 270, impressions: 12000, conversions: 20, revenue: 780, roas: 3.25 },
      ];
      return NextResponse.json({ cities: demoCities, demo: true });
    }
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const cities = await getCityPerformance(from, to, country);
      return NextResponse.json({ cities });
    } catch (err) {
      console.error("[Marketing Cities API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch city data" },
        { status: 500 }
      );
    }
  }

  // --- Demographics endpoint ---
  if (view === "demographics") {
    if (demo) {
      return NextResponse.json({
        age: [
          { ageRange: "18-24", ad_spend: 400, clicks: 600, impressions: 30000, conversions: 20, revenue: 800, roas: 2.0 },
          { ageRange: "25-34", ad_spend: 1200, clicks: 1500, impressions: 70000, conversions: 120, revenue: 4800, roas: 4.0 },
          { ageRange: "35-44", ad_spend: 1400, clicks: 1600, impressions: 75000, conversions: 150, revenue: 5600, roas: 4.0 },
          { ageRange: "45-54", ad_spend: 1000, clicks: 1100, impressions: 50000, conversions: 100, revenue: 3800, roas: 3.8 },
          { ageRange: "55-64", ad_spend: 600, clicks: 650, impressions: 30000, conversions: 50, revenue: 1800, roas: 3.0 },
          { ageRange: "65+", ad_spend: 200, clicks: 200, impressions: 10000, conversions: 15, revenue: 500, roas: 2.5 },
          { ageRange: "Unknown", ad_spend: 100, clicks: 120, impressions: 5000, conversions: 5, revenue: 150, roas: 1.5 },
        ],
        gender: [
          { gender: "Male", ad_spend: 2800, clicks: 3200, impressions: 150000, conversions: 280, revenue: 10500, roas: 3.75 },
          { gender: "Female", ad_spend: 1800, clicks: 2000, impressions: 95000, conversions: 160, revenue: 6200, roas: 3.44 },
          { gender: "Unknown", ad_spend: 300, clicks: 370, impressions: 18000, conversions: 20, revenue: 750, roas: 2.5 },
        ],
        demo: true,
      });
    }
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const [age, gender] = await Promise.all([
        getAgePerformance(from, to),
        getGenderPerformance(from, to),
      ]);
      return NextResponse.json({ age, gender });
    } catch (err) {
      console.error("[Marketing Demographics API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch demographics" },
        { status: 500 }
      );
    }
  }

  // --- Languages endpoint ---
  if (view === "languages") {
    if (demo) {
      return NextResponse.json({
        languages: [
          { language: "English", ad_spend: 4200, clicks: 4800, impressions: 220000, conversions: 400, revenue: 15200, roas: 3.62 },
          { language: "Spanish", ad_spend: 600, clicks: 680, impressions: 32000, conversions: 50, revenue: 1800, roas: 3.0 },
          { language: "French", ad_spend: 200, clicks: 220, impressions: 10000, conversions: 15, revenue: 550, roas: 2.75 },
        ],
        demo: true,
      });
    }
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const languages = await getLanguagePerformance(from, to);
      return NextResponse.json({ languages });
    } catch (err) {
      console.error("[Marketing Languages API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch language data" },
        { status: 500 }
      );
    }
  }

  // --- Search Terms endpoint ---
  if (view === "search-terms") {
    if (demo) return NextResponse.json({ searchTerms: generateDemoSearchTerms(), demo: true });
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const searchTerms = await getSearchTerms(from, to);
      return NextResponse.json({ searchTerms });
    } catch (err) {
      console.error("[Marketing Search Terms API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch search terms" },
        { status: 500 }
      );
    }
  }

  // --- History endpoint for charts ---
  if (view === "history") {
    if (demo) {
      return NextResponse.json({ history: generateDemoHistory(from, to), demo: true });
    }
    if (!isGoogleAdsConfigured())
      return NextResponse.json({ error: "Google Ads not configured" }, { status: 503 });
    try {
      const fetches: [Promise<Awaited<ReturnType<typeof getDailyAdMetrics>>>, Promise<Awaited<ReturnType<typeof getDailyShopifyStats>>>, Promise<Map<string, number> | null>] = [
        getDailyAdMetrics(from, to, market),
        getDailyShopifyStats(from, to, market),
        isGA4Configured()
          ? getDailySessions(from, to).then((rows) => {
              const m = new Map<string, number>();
              for (const r of rows) m.set(r.date, r.sessions);
              return m;
            }).catch(() => null)
          : Promise.resolve(null),
      ];
      const [adsHistory, shopifyDaily, sessionsMap] = await Promise.all(fetches);
      const history = adsHistory.map((day) => {
        const stats = shopifyDaily.get(day.date) ?? { revenue: 0, orders: 0 };
        const rev = Math.round(stats.revenue * 100) / 100;
        return {
          ...day,
          revenue: rev,
          roas: day.ad_spend > 0 ? Math.round((rev / day.ad_spend) * 100) / 100 : 0,
          order_count: stats.orders,
          ...(sessionsMap ? { sessions: sessionsMap.get(day.date) ?? 0 } : {}),
        };
      });
      return NextResponse.json({ history, hasGA4: !!sessionsMap });
    } catch (err) {
      console.error("[Marketing History API]", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch history" },
        { status: 500 }
      );
    }
  }

  // --- Summary endpoint ---
  if (demo) {
    const { current, previous } = generateDemoData(rangeDays || 1);
    return NextResponse.json({
      current,
      previous,
      change: {
        revenue: pctChange(current.revenue, previous.revenue),
        ad_spend: pctChange(current.ad_spend, previous.ad_spend),
        clicks: pctChange(current.clicks, previous.clicks),
        impressions: pctChange(current.impressions, previous.impressions),
        conversions: pctChange(current.conversions, previous.conversions),
        roas: pctChange(current.roas, previous.roas),
        order_count: pctChange(current.order_count, previous.order_count),
      },
      demo: true,
      dateRange: {
        current: { from, to },
        previous: { from: prevFromStr, to: prevToStr },
      },
    });
  }

  if (!isGoogleAdsConfigured())
    return NextResponse.json(
      { error: "Google Ads not configured" },
      { status: 503 }
    );

  try {
    const [currentAds, previousAds, currentShopify, previousShopify] = await Promise.all([
      getAdMetrics(from, to, market),
      getAdMetrics(prevFromStr, prevToStr, market),
      getShopifyStats(from, to, market),
      getShopifyStats(prevFromStr, prevToStr, market),
    ]);

    const current = {
      ...currentAds,
      revenue: Math.round(currentShopify.revenue * 100) / 100,
      roas: currentAds.ad_spend > 0 ? Math.round((currentShopify.revenue / currentAds.ad_spend) * 100) / 100 : 0,
      order_count: currentShopify.orders,
    };
    const previous = {
      ...previousAds,
      revenue: Math.round(previousShopify.revenue * 100) / 100,
      roas: previousAds.ad_spend > 0 ? Math.round((previousShopify.revenue / previousAds.ad_spend) * 100) / 100 : 0,
      order_count: previousShopify.orders,
    };

    return NextResponse.json({
      current,
      previous,
      change: {
        revenue: pctChange(current.revenue, previous.revenue),
        ad_spend: pctChange(current.ad_spend, previous.ad_spend),
        clicks: pctChange(current.clicks, previous.clicks),
        impressions: pctChange(current.impressions, previous.impressions),
        conversions: pctChange(current.conversions, previous.conversions),
        roas: pctChange(current.roas, previous.roas),
        order_count: pctChange(current.order_count, previous.order_count),
      },
      dateRange: {
        current: { from, to },
        previous: { from: prevFromStr, to: prevToStr },
      },
    });
  } catch (err) {
    console.error("[Marketing API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch ad data" },
      { status: 500 }
    );
  }
}

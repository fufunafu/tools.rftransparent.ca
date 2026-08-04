import "server-only";

import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import {
  buildEmployeePerformance,
  getPerformanceWindow,
  performanceQueryStart,
  type EmployeePerformanceInput,
  type EmployeePerformancePayload,
  type PerformanceEmployeeRow,
  type PerformanceFollowupRow,
  type PerformanceLeadCallRow,
  type PerformanceLeadRow,
  type PerformanceLocation,
  type PerformancePhoneCallRow,
  type PerformanceQuoteRow,
  type PerformanceRange,
  type PerformanceWarehouseRow,
} from "@/lib/employee-performance";

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function loadEmployeePerformanceInput(
  range: PerformanceRange,
  now: Date,
  location: PerformanceLocation,
): Promise<EmployeePerformanceInput> {
  const supabase = getSupabase();
  const queryStart = performanceQueryStart(range, now);
  const phoneStoreIds = [
    ...(location.shopifyStoreIds.some((storeId) => storeId === "store1" || storeId === "store2")
      ? ["rf_transparent"]
      : []),
    ...(location.shopifyStoreIds.includes("store3") ? ["bc_transparent"] : []),
  ];

  const [employees, quotes, followups, leads, leadCalls, phoneCalls, warehouseReports] = await Promise.all([
    fetchAllRows<PerformanceEmployeeRow>((from, to) =>
      supabase
        .from("employees")
        .select("id,name,email,email_alt,department,shopify_tags,active,location_id,locations(name,shopify_store_ids)")
        .eq("active", true)
        .order("name", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
          data: PerformanceEmployeeRow[] | null;
          error: { message: string } | null;
        }>,
    ),
    fetchAllRows<PerformanceQuoteRow>((from, to) =>
      supabase
        .from("followup_leads")
        .select("id,draft_name,customer_email,customer_phone,quote_amount,shopify_status,lead_status,next_followup_at,closed_at,shopify_created_at,first_synced_at,last_invoice_sender,created_by_staff")
        .in("store_id", location.shopifyStoreIds)
        .order("shopify_created_at", { ascending: true, nullsFirst: true })
        .range(from, to) as unknown as PromiseLike<{
          data: PerformanceQuoteRow[] | null;
          error: { message: string } | null;
        }>,
    ),
    fetchAllRows<PerformanceFollowupRow>((from, to) => {
      let query = supabase
        .from("followup_logs")
        .select("id,lead_id,logged_by,created_at,followup_leads!inner(store_id)")
        .in("followup_leads.store_id", location.shopifyStoreIds)
        .order("created_at", { ascending: true });
      if (queryStart) query = query.gte("created_at", queryStart);
      return query.range(from, to) as unknown as PromiseLike<{
        data: PerformanceFollowupRow[] | null;
        error: { message: string } | null;
      }>;
    }),
    fetchAllRows<PerformanceLeadRow>((from, to) =>
      supabase
        .from("leads")
        .select("id,email,phone")
        .order("submitted_at", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<PerformanceLeadCallRow>((from, to) => {
      let query = supabase
        .from("lead_call_attempts")
        .select("id,lead_id,called_at")
        .order("called_at", { ascending: true });
      if (queryStart) query = query.gte("called_at", queryStart);
      return query.range(from, to);
    }),
    fetchAllRows<PerformancePhoneCallRow>((from, to) => {
      let query = supabase
        .from("call_records")
        .select("id,call_start,from_number,to_number,direction,duration_min,endpoint")
        .in("store_id", phoneStoreIds)
        .order("call_start", { ascending: true });
      if (queryStart) query = query.gte("call_start", queryStart);
      return query.range(from, to) as unknown as PromiseLike<{
        data: PerformancePhoneCallRow[] | null;
        error: { message: string } | null;
      }>;
    }),
    fetchAllRows<PerformanceWarehouseRow>((from, to) => {
      let query = supabase
        .from("warehouse_daily_reports")
        .select("employee_id,report_date,boxes_built,orders_packed,walkin_pickup")
        .order("report_date", { ascending: true });
      if (queryStart) query = query.gte("report_date", queryStart.slice(0, 10));
      return query.range(from, to);
    }),
  ]);

  return {
    employees,
    includedEmployeeIds: employees
      .filter((employee) => employee.location_id === location.id)
      .map((employee) => employee.id),
    quotes,
    followups,
    leads,
    leadCalls,
    phoneCalls,
    warehouseReports,
  };
}

async function loadAndBuildPerformance(
  range: PerformanceRange,
  now: Date,
  location: PerformanceLocation,
  locations: PerformanceLocation[],
): Promise<EmployeePerformancePayload> {
  const input = await loadEmployeePerformanceInput(range, now, location);
  return buildEmployeePerformance(input, range, now, location, locations);
}

export async function getPerformanceLocationOptions(): Promise<PerformanceLocation[]> {
  const { data, error } = await getSupabase()
    .from("locations")
    .select("id,name,shopify_store_ids")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((location) => ({
      id: location.id,
      name: location.name,
      shopifyStoreIds: location.shopify_store_ids ?? [],
    }))
    .filter((location) => location.shopifyStoreIds.length > 0);
}

export async function getEmployeePerformance(
  range: PerformanceRange,
  locationId: string,
  providedLocations?: PerformanceLocation[],
): Promise<EmployeePerformancePayload> {
  const locations = providedLocations ?? await getPerformanceLocationOptions();
  const location = locations.find((candidate) => candidate.id === locationId);
  if (!location) throw new Error(`Unknown performance location: ${locationId}`);
  const now = new Date();
  const day = getPerformanceWindow(range, now).today;
  return unstable_cache(
    () => loadAndBuildPerformance(range, now, location, locations),
    ["employee-performance-v3", location.id, range, String(day)],
    { revalidate: 300 },
  )();
}

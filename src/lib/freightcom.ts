import { fetchWithRetry } from "@/lib/fetch-retry";

// Freightcom customer API (https://developer.freightcom.com). Rating is
// asynchronous: POST /rate returns 202 + a request_id, then GET /rate/{id}
// is polled until status.done is true. The API key is generated in the
// Freightcom customer portal and sent as-is in the Authorization header.

const BASE_URL = "https://external-api.freightcom.com";

export interface FreightcomAddress {
  address_line_1: string;
  address_line_2?: string;
  unit_number?: string;
  city: string;
  region: string;   // province/state code, e.g. ON
  country: string;  // ISO 3166-1 alpha-2, e.g. CA
  postal_code: string;
}

export interface FreightcomLocation {
  name?: string;
  address: FreightcomAddress;
  residential?: boolean;
  tailgate_required?: boolean;
  instructions?: string;
  contact_name?: string;
  phone_number?: { number: string; extension?: string };
  email_addresses?: string[];
}

export interface FreightcomPackage {
  measurements: {
    weight: { unit: "kg" | "lb" | "g" | "oz"; value: number };
    cuboid: { unit: "mm" | "cm" | "m" | "in" | "ft"; l: number; w: number; h: number };
  };
  description: string;
  special_handling_required?: boolean;
}

export interface FreightcomRateRequest {
  services?: string[];
  excluded_services?: string[];
  details: {
    origin: FreightcomLocation;
    destination: FreightcomLocation & {
      ready_at: { hour: number; minute: number };
      ready_until: { hour: number; minute: number };
      signature_requirement: "not-required" | "required" | "adult-required";
    };
    expected_ship_date: { year: number; month: number; day: number };
    packaging_type: "package";
    packaging_properties: {
      packages: FreightcomPackage[];
      includes_return_label?: boolean;
      has_dangerous_goods?: boolean;
    };
    reference_codes?: string[];
    shipment_classification?: "B2B" | "B2C" | "C2B" | "C2C";
  };
}

export interface FreightcomMoney {
  currency: string;
  // Lowest unit of the currency (cents), as a string.
  value: string;
}

export interface FreightcomRate {
  carrier_name: string;
  service_name: string;
  service_id: string;
  valid_until?: { year: number; month: number; day: number };
  total: FreightcomMoney;
  base?: FreightcomMoney;
  surcharges?: { type: string; amount: FreightcomMoney }[];
  taxes?: { type: string; amount: FreightcomMoney }[];
  transit_time_days?: number;
  transit_time_not_available?: boolean;
}

export interface FreightcomRateResult {
  status: { done: boolean; total: number; complete: number };
  rates: FreightcomRate[];
}

export function isFreightcomConfigured(): boolean {
  return Boolean(process.env.FREIGHTCOM_API_KEY);
}

function apiKey(): string {
  const key = process.env.FREIGHTCOM_API_KEY;
  if (!key) throw new Error("Missing FREIGHTCOM_API_KEY env var");
  return key;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Freightcom ${init?.method ?? "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function requestRate(body: FreightcomRateRequest): Promise<string> {
  const data = await call<{ request_id: string }>("/rate", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!data.request_id) throw new Error("Freightcom /rate returned no request_id");
  return data.request_id;
}

export async function getRate(requestId: string): Promise<FreightcomRateResult> {
  const data = await call<Partial<FreightcomRateResult>>(`/rate/${encodeURIComponent(requestId)}`);
  return {
    status: data.status ?? { done: false, total: 0, complete: 0 },
    rates: data.rates ?? [],
  };
}

/**
 * Polls a rate request until Freightcom reports it done or the time budget
 * runs out. Returns whatever rates were available at the end, plus whether
 * the search completed — a partial result is still worth showing.
 */
export async function waitForRate(
  requestId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<FreightcomRateResult> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let last = await getRate(requestId);
  while (!last.status.done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await getRate(requestId);
  }
  return last;
}

export async function listServices(): Promise<{ id: string; carrier_name: string; service_name: string }[]> {
  const data = await call<{ services?: { id: string; carrier_name: string; service_name: string }[] }>("/services");
  return data.services ?? [];
}

export function moneyToNumber(money: FreightcomMoney | undefined): number | null {
  if (!money) return null;
  const cents = Number(money.value);
  return Number.isFinite(cents) ? cents / 100 : null;
}

export function cheapestRate(rates: FreightcomRate[]): FreightcomRate | null {
  let best: FreightcomRate | null = null;
  let bestTotal = Infinity;
  for (const rate of rates) {
    const total = moneyToNumber(rate.total);
    if (total === null) continue;
    if (total < bestTotal) {
      best = rate;
      bestTotal = total;
    }
  }
  return best;
}

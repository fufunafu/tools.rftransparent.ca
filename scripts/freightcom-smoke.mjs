// Smoke test for the Freightcom API — proves auth, rating, and polling work
// against whichever environment FREIGHTCOM_API_URL points at (their sandbox
// or live). Reads FREIGHTCOM_API_KEY / FREIGHTCOM_API_URL from the
// environment or .env.local. Run:
//
//   node scripts/freightcom-smoke.mjs
//
// It requests rates for one default box from Etobicoke to Ottawa and prints
// every carrier rate returned, cheapest first. Read-only: rating creates no
// shipment and costs nothing.
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
}
loadEnvLocal();

const BASE = (process.env.FREIGHTCOM_API_URL || "https://external-api.freightcom.com").replace(/\/+$/, "");
const KEY = process.env.FREIGHTCOM_API_KEY;
if (!KEY) {
  console.error("FREIGHTCOM_API_KEY is not set (env or .env.local)");
  process.exit(1);
}
console.log(`Environment: ${BASE}`);

async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: KEY, "Content-Type": "application/json", Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// 1. Auth check via /services
const services = await call("/services");
console.log(`/services OK — ${services.services?.length ?? 0} services available`);

// 2. Rate request: one 30 lb 48x12x12 box, Etobicoke -> Ottawa
const d = new Date(Date.now() + 86_400_000 * (new Date().getDay() >= 5 ? 3 : 1));
const body = {
  details: {
    origin: {
      name: "RF Transparent",
      address: { address_line_1: "67 Westmore Dr", unit_number: "19", city: "Etobicoke", region: "ON", country: "CA", postal_code: "M9V 3Y6" },
      residential: false,
      contact_name: "Warehouse",
      phone_number: { number: "6477404552" },
    },
    destination: {
      name: "Test Customer",
      address: { address_line_1: "150 Elgin St", city: "Ottawa", region: "ON", country: "CA", postal_code: "K2P 1L4" },
      residential: true,
      contact_name: "Test Customer",
      phone_number: { number: "6135550199" },
      ready_at: { hour: 9, minute: 0 },
      ready_until: { hour: 17, minute: 0 },
      signature_requirement: "not-required",
    },
    expected_ship_date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
    packaging_type: "package",
    packaging_properties: {
      packages: [{ measurements: { weight: { unit: "lb", value: 30 }, cuboid: { unit: "in", l: 48, w: 12, h: 12 } }, description: "Glass railing hardware (test)" }],
      includes_return_label: false,
      has_dangerous_goods: false,
    },
    reference_codes: ["SMOKE-TEST"],
    shipment_classification: "B2C",
  },
};
const { request_id } = await call("/rate", { method: "POST", body: JSON.stringify(body) });
console.log(`/rate accepted — request_id ${request_id}`);

// 3. Poll until done (max ~60s)
let result;
for (let i = 0; i < 30; i++) {
  result = await call(`/rate/${encodeURIComponent(request_id)}`);
  const s = result.status ?? {};
  process.stdout.write(`\r  polling: ${s.complete ?? 0}/${s.total ?? "?"} carriers${s.done ? " — done" : ""}   `);
  if (s.done) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log();

const rates = (result?.rates ?? [])
  .map((r) => ({ carrier: r.carrier_name, service: r.service_name, total: Number(r.total?.value) / 100, currency: r.total?.currency, days: r.transit_time_not_available ? "?" : r.transit_time_days }))
  .sort((a, b) => a.total - b.total);

if (rates.length === 0) {
  console.log("No rates returned. Raw response:");
  console.log(JSON.stringify(result, null, 2).slice(0, 2000));
  process.exit(2);
}
console.log(`\n${rates.length} rates, cheapest first:`);
for (const r of rates.slice(0, 15)) {
  console.log(`  $${r.total.toFixed(2)} ${r.currency}  ${r.carrier} — ${r.service} (${r.days} days)`);
}
console.log("\nSmoke test PASSED — auth, rating, and polling all work.");

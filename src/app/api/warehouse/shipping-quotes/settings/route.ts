import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { canViewShippingQuotes } from "@/lib/shipping-quotes-access";
import { recordSettingChange } from "@/lib/settings-audit";
import {
  getShippingQuoteSettings,
  putShippingQuoteSettings,
  SHIPPING_QUOTE_DEFAULTS,
  type ShippingQuoteSettings,
} from "@/lib/shipping-quotes";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!(await canViewShippingQuotes()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  return NextResponse.json({ settings: await getShippingQuoteSettings() }, { headers: NO_STORE });
}

function str(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : fallback;
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.email || !(await isManagementUser()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const body = await req.json().catch(() => ({}));
  const incoming = body?.settings;
  if (!incoming || typeof incoming !== "object")
    return NextResponse.json({ error: "settings object is required" }, { status: 400, headers: NO_STORE });

  const d = SHIPPING_QUOTE_DEFAULTS;
  const o = incoming.origin ?? {};
  const p = incoming.default_package ?? {};
  const c = incoming.crate ?? {};
  const clean: ShippingQuoteSettings = {
    origin: {
      name: str(o.name) || d.origin.name,
      contact_name: str(o.contact_name),
      phone: str(o.phone, 30),
      email: str(o.email),
      address_line_1: str(o.address_line_1),
      address_line_2: str(o.address_line_2),
      city: str(o.city),
      region: str(o.region, 3).toUpperCase(),
      country: (str(o.country, 2).toUpperCase() || d.origin.country),
      postal_code: str(o.postal_code, 12).toUpperCase(),
    },
    default_package: {
      weight_lb: num(p.weight_lb, d.default_package.weight_lb),
      length_in: num(p.length_in, d.default_package.length_in),
      width_in: num(p.width_in, d.default_package.width_in),
      height_in: num(p.height_in, d.default_package.height_in),
    },
    skip_shipping_methods: Array.isArray(incoming.skip_shipping_methods)
      ? incoming.skip_shipping_methods.map((m: unknown) => str(m, 60)).filter(Boolean).slice(0, 20)
      : d.skip_shipping_methods,
    lookback_days: Math.min(60, Math.round(num(incoming.lookback_days, d.lookback_days))),
    max_package_weight_lb: Math.min(500, num(incoming.max_package_weight_lb, d.max_package_weight_lb)),
    crate: {
      glass_per_crate: Math.min(100, Math.round(num(c.glass_per_crate, d.crate.glass_per_crate))),
      length_in: num(c.length_in, d.crate.length_in),
      width_in: num(c.width_in, d.crate.width_in),
      height_in: num(c.height_in, d.crate.height_in),
      tare_lb: num(c.tare_lb, d.crate.tare_lb),
      glass_sku_prefixes: Array.isArray(c.glass_sku_prefixes)
        ? c.glass_sku_prefixes.map((v: unknown) => str(v, 20).toUpperCase()).filter(Boolean).slice(0, 20)
        : d.crate.glass_sku_prefixes,
      glass_title_keywords: Array.isArray(c.glass_title_keywords)
        ? c.glass_title_keywords.map((v: unknown) => str(v, 40).toLowerCase()).filter(Boolean).slice(0, 20)
        : d.crate.glass_title_keywords,
    },
  };

  await putShippingQuoteSettings(clean);
  await recordSettingChange({
    area: "rates",
    actor: user.email,
    summary: `Shipping quote settings updated: origin ${clean.origin.city || "?"} ${clean.origin.postal_code || "?"}, default box ${clean.default_package.weight_lb} lb`,
  });
  return NextResponse.json({ settings: clean }, { headers: NO_STORE });
}

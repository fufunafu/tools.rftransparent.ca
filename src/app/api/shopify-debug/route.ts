// TEMPORARY DIAGNOSTIC — safe to delete.
// GET  /api/shopify-debug        — probes every configured store with its env creds
// POST /api/shopify-debug        — body: { store, clientId, clientSecret }
//                                  probes a single store with ad-hoc creds (does not
//                                  touch env or config) — useful for testing a new
//                                  app's credentials before rolling them out.

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { STORES } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface StoreDiagnostic {
  store: string;
  label: string;
  clientIdPrefix: string;
  tokenFetch: {
    ok: boolean;
    status?: number;
    scope?: string;
    scopeList?: string[];
    error?: string;
  };
  currentAppInstallation: unknown;
  staffMembersProbe: unknown;
}

async function diagnoseStore(config: {
  store: string;
  label: string;
  clientId: string;
  clientSecret: string;
}): Promise<StoreDiagnostic> {
  const result: StoreDiagnostic = {
    store: config.store,
    label: config.label,
    clientIdPrefix: `${config.clientId.slice(0, 8)}…${config.clientId.slice(-4)}`,
    tokenFetch: { ok: false },
    currentAppInstallation: null,
    staffMembersProbe: null,
  };

  // 1) Request a fresh client_credentials token
  let accessToken: string | null = null;
  try {
    const res = await fetch(`https://${config.store}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      result.tokenFetch = { ok: false, status: res.status, error: body };
      return result;
    }
    const parsed = JSON.parse(body) as { access_token: string; scope?: string };
    accessToken = parsed.access_token;
    result.tokenFetch = {
      ok: true,
      status: res.status,
      scope: parsed.scope,
      scopeList: parsed.scope ? parsed.scope.split(",").map((s) => s.trim()) : [],
    };
  } catch (err) {
    result.tokenFetch = { ok: false, error: err instanceof Error ? err.message : String(err) };
    return result;
  }

  // 2) currentAppInstallation — reveals which app the token belongs to
  try {
    const res = await fetch(`https://${config.store}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `{
          currentAppInstallation {
            id
            app { id title handle apiKey }
            accessScopes { handle }
          }
        }`,
      }),
    });
    result.currentAppInstallation = await res.json();
  } catch (err) {
    result.currentAppInstallation = { error: err instanceof Error ? err.message : String(err) };
  }

  // 3) Try staffMembers
  try {
    const res = await fetch(`https://${config.store}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `{
          staffMembers(first: 1) {
            edges { node { id name email } }
          }
        }`,
      }),
    });
    result.staffMembersProbe = await res.json();
  } catch (err) {
    result.staffMembersProbe = { error: err instanceof Error ? err.message : String(err) };
  }

  return result;
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await Promise.all(STORES.map(diagnoseStore));
  return NextResponse.json(
    { checked_at: new Date().toISOString(), stores: results },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { store?: string; clientId?: string; clientSecret?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const store = body.store?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const clientId = body.clientId?.trim();
  const clientSecret = body.clientSecret?.trim();

  if (!store || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing required fields: store, clientId, clientSecret" },
      { status: 400 }
    );
  }

  const result = await diagnoseStore({
    store,
    label: body.label?.trim() || store,
    clientId,
    clientSecret,
  });

  return NextResponse.json(
    { checked_at: new Date().toISOString(), store: result },
    { headers: { "Cache-Control": "no-store" } }
  );
}

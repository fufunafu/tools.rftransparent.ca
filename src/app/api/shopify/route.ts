import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { shopifyGraphQL, getStores } from "@/lib/shopify";

export async function GET() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Returns list of configured store IDs + labels (no secrets)
  return NextResponse.json({
    stores: getStores().map(({ id, label }) => ({ id, label })),
  });
}

export async function POST(req: NextRequest) {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { storeId, query, variables } = await req.json();
  if (!storeId || !query) {
    return NextResponse.json({ error: "Missing storeId or query" }, { status: 400 });
  }

  const store = getStores().find((s) => s.id === storeId);
  if (!store) {
    return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400 });
  }

  try {
    const data = await shopifyGraphQL(storeId, query, variables);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Shopify API]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

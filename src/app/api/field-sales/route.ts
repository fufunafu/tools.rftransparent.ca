import { NextRequest, NextResponse } from "next/server";
import { canAccessFieldSales, getFieldSalesActor } from "@/lib/field-sales-access";
import { FieldSalesDataError, loadFieldSalesPayload } from "@/lib/field-sales-data";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest) {
  const actor = await getFieldSalesActor();
  if (!actor) return response({ error: "Unauthorized" }, 401);
  if (!canAccessFieldSales(actor)) return response({ error: "Forbidden" }, 403);

  const requestedScope = request.nextUrl.searchParams.get("scope") === "team" ? "team" : "mine";
  const employeeId = request.nextUrl.searchParams.get("employeeId");

  try {
    return response(await loadFieldSalesPayload(actor, requestedScope, employeeId));
  } catch (error) {
    if (error instanceof FieldSalesDataError) {
      return response({ error: error.message }, error.status);
    }
    console.error("Failed to load field sales workspace", error);
    return response(
      { error: "Field sales is temporarily unavailable. If this is the first use, apply the field-sales database migration." },
      503,
    );
  }
}

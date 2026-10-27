import { NextResponse } from "next/server";
import { getAuthenticatedUser, isManagementUser } from "@/lib/admin-auth";
import { runCrmSync } from "@/lib/crm/sync";
import { CrmInputError, readCrmJson } from "@/lib/crm/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!(await getAuthenticatedUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!(await isManagementUser())) return NextResponse.json({ error: "Only management may run an import." }, { status: 403, headers });
  try {
    const body = await readCrmJson(request) as { restart?: unknown };
    return NextResponse.json(await runCrmSync(body?.restart === true), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CrmInputError ? error.message : "Import paused after an error. Saved pages are retained. Resume to retry." }, { status: error instanceof CrmInputError ? error.status : 503, headers });
  }
}

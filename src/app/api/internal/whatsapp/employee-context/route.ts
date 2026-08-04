import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  isValidWhatsAppAssistantSecret,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp-employee-context";

export const dynamic = "force-dynamic";

type EmployeeLookupRow = {
  id: string;
  name: string;
  department: string | null;
  phone: string | null;
  locations: { name: string | null } | null;
};

export async function POST(request: Request) {
  if (!isValidWhatsAppAssistantSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  const phone = typeof payload?.phone === "string" ? normalizeWhatsAppPhone(payload.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "A valid phone number is required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id, name, department, phone, location_id, locations(name)")
    .eq("active", true)
    .not("phone", "is", null)
    .overrideTypes<EmployeeLookupRow[], { merge: false }>();

  if (employeeError) {
    return NextResponse.json({ error: "Employee lookup failed" }, { status: 500 });
  }

  const employee = (employees ?? []).find((candidate) =>
    typeof candidate.phone === "string" && normalizeWhatsAppPhone(candidate.phone) === phone
  );
  if (!employee) return NextResponse.json({ employee: null, survey: null });

  const { data: survey, error: surveyError } = await supabase
    .from("employee_surveys")
    .select("token, week_of, responded_at, created_at")
    .eq("employee_id", employee.id)
    .order("week_of", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (surveyError) {
    return NextResponse.json({ error: "Survey lookup failed" }, { status: 500 });
  }

  const location = employee.locations?.name ?? null;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://tools.rftransparent.ca").replace(/\/+$/, "");

  return NextResponse.json({
    employee: {
      id: employee.id,
      name: employee.name,
      department: employee.department,
      location,
    },
    survey: survey
      ? {
          weekOf: survey.week_of,
          completed: survey.responded_at !== null,
          link: survey.responded_at ? null : `${appUrl}/survey/${survey.token}`,
        }
      : null,
  });
}

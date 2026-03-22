import { NextRequest, NextResponse } from "next/server";
import { isEmployeeAuthenticated, setSelectedEmployee } from "@/lib/employee-auth";

export async function POST(req: NextRequest) {
  if (!(await isEmployeeAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { employeeId } = await req.json();
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
  }

  await setSelectedEmployee(employeeId);
  return NextResponse.json({ ok: true });
}

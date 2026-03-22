import { NextRequest, NextResponse } from "next/server";
import { validatePassword, setSessionCookie } from "@/lib/employee-auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!validatePassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await setSessionCookie();
  return NextResponse.json({ ok: true });
}

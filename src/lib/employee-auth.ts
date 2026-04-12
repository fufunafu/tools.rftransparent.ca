import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const EMPLOYEE_ID_COOKIE = "employee_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

export async function isEmployeeAuthenticated(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user;
}

export async function clearSessionCookies(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(EMPLOYEE_ID_COOKIE);
}

export async function setSelectedEmployee(employeeId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(EMPLOYEE_ID_COOKIE, employeeId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getSelectedEmployeeId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(EMPLOYEE_ID_COOKIE)?.value ?? null;
}

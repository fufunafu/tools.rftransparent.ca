import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthenticated, isAdminUser } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import NewEmployeeForm from "@/components/admin/NewEmployeeForm";

export const metadata: Metadata = {
  title: "New employee | RF Tools",
  robots: { index: false, follow: false },
};

// The lists come from the same tables the hub reads, so a department invented
// on an existing profile shows up here without a code change.
export const dynamic = "force-dynamic";

const KNOWN_DEPARTMENTS = ["sales", "marketing", "customer_service", "warehouse", "management"];

async function getDepartments(): Promise<string[]> {
  try {
    const { data, error } = await getSupabase()
      .from("employees")
      .select("department")
      .not("department", "is", null);
    if (error) return KNOWN_DEPARTMENTS;
    const seen = new Set<string>(KNOWN_DEPARTMENTS);
    for (const row of data ?? []) {
      const value = (row as { department?: string }).department;
      if (value) seen.add(value);
    }
    return [...seen].sort();
  } catch {
    return KNOWN_DEPARTMENTS;
  }
}

async function getLocations(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await getSupabase().from("locations").select("id, name").order("name");
    if (error) return [];
    return (data ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

export default async function NewEmployeePage() {
  if (!(await isAuthenticated())) redirect("/login");
  // An employees row is a way into the company's data, so creating one is the
  // same administrative act as editing the access list.
  if (!(await isAdminUser())) redirect("/access-denied");

  const [departments, locations] = await Promise.all([getDepartments(), getLocations()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <NewEmployeeForm departments={departments} locations={locations} />
    </div>
  );
}

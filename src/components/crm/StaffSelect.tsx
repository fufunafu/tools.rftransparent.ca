"use client";
import useSWR from "swr";
import type { CrmStaffMember } from "@/lib/crm/staff";
import { fetchJson, INPUT, ownerLabel } from "./shared";

const STAFF_OPTIONS = { revalidateOnFocus: false, dedupingInterval: 300_000 };
export function useCrmStaff() {
  return useSWR<{ staff: CrmStaffMember[] }>("/api/crm/staff", fetchJson, STAFF_OPTIONS);
}

/** Teammate picker. Keeps the current value even if that person has left. */
export default function StaffSelect({ name, label, value, defaultValue, onChange, allowUnassigned = false, email }: {
  name?: string; label: string; value?: string; defaultValue?: string; onChange?: (value: string) => void; allowUnassigned?: boolean; email: string;
}) {
  const { data, error } = useCrmStaff();
  const current = value ?? defaultValue ?? "";
  const people = [...(data?.staff ?? [])];
  for (const extra of [email, current]) if (extra && !people.some(person => person.email === extra)) people.push({ email: extra, name: ownerLabel(extra), department: "" });
  return <label className="block text-sm font-medium">{label}
    <select name={name} value={value} defaultValue={value === undefined ? defaultValue : undefined} onChange={event => onChange?.(event.target.value)} className={`${INPUT} capitalize`}>
      {allowUnassigned && <option value="">Unassigned</option>}
      {people.sort((a, b) => a.name.localeCompare(b.name)).map(person => <option key={person.email} value={person.email}>{person.email === email ? `${person.name} (me)` : person.name}</option>)}
    </select>
    {error && <span className="mt-1 block text-xs font-normal text-amber-700">Staff list unavailable. Showing known people only.</span>}
  </label>;
}

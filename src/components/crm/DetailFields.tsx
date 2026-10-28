"use client";
import type { CrmType } from "@/lib/crm/types";
import { CALL_DIRECTIONS, CALL_OUTCOMES, EMAIL_DIRECTIONS, MEETING_OUTCOMES, TASK_PRIORITIES, TASK_TYPES } from "@/lib/crm/productivity";
import { INPUT } from "./shared";

function Choice({ name, label, options, value, blank = "Not set" }: { name: string; label: string; options: Record<string, string>; value?: string; blank?: string }) {
  return <label className="block text-sm font-medium">{label}
    <select name={name} defaultValue={value ?? ""} className={INPUT}><option value="">{blank}</option>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
  </label>;
}

/** Outcome, direction, duration, priority and type fields for one record type. */
export default function DetailFields({ type, values = {} }: { type: CrmType; values?: Record<string, string | undefined> }) {
  if (type === "calls") return <div className="grid gap-3 sm:grid-cols-3">
    <Choice name="call_direction" label="Direction" options={CALL_DIRECTIONS} value={values.call_direction} />
    <Choice name="call_outcome" label="Outcome" options={CALL_OUTCOMES} value={values.call_outcome} />
    <label className="block text-sm font-medium">Minutes<input name="duration_minutes" type="number" min={0} max={1440} inputMode="numeric" defaultValue={values.duration_minutes ?? ""} className={INPUT} /></label>
  </div>;
  if (type === "meetings") return <div className="grid gap-3 sm:grid-cols-2">
    <Choice name="meeting_outcome" label="Outcome" options={MEETING_OUTCOMES} value={values.meeting_outcome} />
    <label className="block text-sm font-medium">Minutes<input name="duration_minutes" type="number" min={0} max={1440} inputMode="numeric" defaultValue={values.duration_minutes ?? ""} className={INPUT} /></label>
  </div>;
  if (type === "emails") return <Choice name="email_direction" label="Direction" options={EMAIL_DIRECTIONS} value={values.email_direction} />;
  if (type === "tasks") return <div className="grid gap-3 sm:grid-cols-2">
    <Choice name="task_type" label="Task type" options={TASK_TYPES} value={values.task_type} />
    <Choice name="priority" label="Priority" options={TASK_PRIORITIES} value={values.priority} blank="None" />
  </div>;
  return null;
}

/** Reads the detail fields present on a submitted form. Blank means "not set". */
export function readDetails(form: FormData) {
  const keys = ["call_direction", "call_outcome", "duration_minutes", "meeting_outcome", "email_direction", "task_type", "priority"];
  return Object.fromEntries(keys.filter(key => form.has(key)).map(key => [key, String(form.get(key) ?? "").trim()]));
}

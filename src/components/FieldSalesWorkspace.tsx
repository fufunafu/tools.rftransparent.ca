"use client";

import { FormEvent, useMemo, useState } from "react";
import { getCurrentPosition, type LocationProgress } from "@/lib/app-geolocation";
import type {
  FieldSalesAccount,
  FieldSalesAppointment,
  FieldSalesFollowup,
  FieldSalesPayload,
  FieldSalesQuoteCandidate,
  FieldSalesVisit,
} from "@/lib/field-sales-types";

const INPUT = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const LABEL = "block text-xs font-bold uppercase tracking-wide text-slate-600";
const PRIMARY = "min-h-11 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition active:bg-slate-50 disabled:opacity-50";

const outcomeOptions = [
  ["follow_up", "Follow-up needed"],
  ["quote_requested", "Quote requested"],
  ["sample_left", "Sample left"],
  ["order_expected", "Order expected"],
  ["not_interested", "Not interested"],
  ["other", "Other"],
] as const;

const nextActionOptions = [
  ["follow_up", "Follow up"],
  ["prepare_quote", "Prepare quote"],
  ["send_samples", "Send samples"],
  ["call_contact", "Call contact"],
  ["schedule_visit", "Schedule another visit"],
  ["no_further_action", "No further action"],
] as const;

function localDateInput(daysFromToday = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function apiErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  return fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

function durationLabel(visit: FieldSalesVisit): string {
  const end = visit.checkedOutAt ? Date.parse(visit.checkedOutAt) : Date.now();
  const minutes = Math.max(0, Math.round((end - Date.parse(visit.checkedInAt)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function verificationLabel(visit: FieldSalesVisit): string {
  if (visit.locationVerification === "verified") {
    return visit.distanceFromSiteM == null ? "Location verified" : `Verified within ${visit.distanceFromSiteM} m`;
  }
  if (visit.locationVerification === "pin_created") return "Customer location saved";
  if (visit.locationVerification === "outside_radius") {
    return visit.distanceFromSiteM == null ? "Outside saved location" : `${visit.distanceFromSiteM} m from saved location`;
  }
  return "Location recorded, site not yet verified";
}

function verificationClass(visit: FieldSalesVisit): string {
  return visit.locationVerification === "outside_radius"
    ? "bg-amber-50 text-amber-800 ring-amber-200"
    : visit.locationVerification === "unverified"
      ? "bg-slate-100 text-slate-700 ring-slate-200"
      : "bg-emerald-50 text-emerald-800 ring-emerald-200";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={LABEL}>{label}{children}</label>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">{children}</div>;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>;
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

interface CheckInTarget {
  appointmentId: string | null;
  accountId: string;
  accountName: string;
  address: string;
  hasSitePin: boolean;
}

function CheckInPanel({
  target,
  onClose,
  onComplete,
}: {
  target: CheckInTarget;
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [odometer, setOdometer] = useState("");
  const [savePin, setSavePin] = useState(!target.hasSitePin);
  const [progress, setProgress] = useState<LocationProgress | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const position = await getCurrentPosition(setProgress);
    if (!position.ok) {
      const message = position.reason === "denied"
        ? "Location access is off. Enable it in your phone or browser settings, then try again."
        : position.reason === "restricted"
          ? "Location access is restricted on this device."
          : position.reason === "timeout"
            ? "Your location took too long. Move near a window or outdoors and try again."
            : position.reason === "inaccurate"
              ? `Your location is only accurate to about ${position.accuracy} m. Move near a window or outdoors and try again.`
              : "RF Tools could not get your location. Check Location Services and try again.";
      setError(message);
      setProgress(null);
      return;
    }

    setProgress("saving");
    const response = await fetch("/api/field-sales/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointmentId: target.appointmentId,
        accountId: target.accountId,
        position: position.position,
        establishSitePin: savePin,
        odometerStartKm: odometer ? Number(odometer) : null,
      }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The visit could not be started."));
      setProgress(null);
      return;
    }
    await onComplete(target.hasSitePin || !savePin ? "Visit started." : "Visit started and the customer location was saved.");
  };

  const progressLabel = progress === "checking-permission"
    ? "Checking location permission"
    : progress === "requesting-permission"
      ? "Waiting for location permission"
      : progress === "acquiring-location"
        ? "Getting a fresh location"
        : progress === "saving"
          ? "Starting visit"
          : null;

  return (
    <Panel className="border-blue-200 bg-blue-50/40">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Check in</p>
          <h2 className="mt-1 text-lg font-black text-slate-950">{target.accountName}</h2>
          <p className="mt-1 text-sm text-slate-600">{target.address}</p>
        </div>
        <button type="button" className="min-h-10 px-2 text-sm font-bold text-slate-500" onClick={onClose}>Close</button>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Starting odometer, km (optional)">
          <input className={INPUT} type="number" min="0" step="0.1" inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
        </Field>
        {!target.hasSitePin && (
          <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-white p-3 text-sm text-slate-700">
            <input className="mt-0.5 h-5 w-5 rounded border-slate-300" type="checkbox" checked={savePin} onChange={(event) => setSavePin(event.target.checked)} />
            <span><strong className="block text-slate-950">Save this as the customer location</strong>The first confirmed visit creates the site pin used to verify future check-ins.</span>
          </label>
        )}
        <p className="text-xs leading-5 text-slate-500">RF Tools requests one fresh location when you tap below. It does not track you afterward.</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
        {progressLabel && <p aria-live="polite" className="rounded-xl bg-blue-100 px-3 py-2 text-sm font-bold text-blue-900">{progressLabel}...</p>}
        <button type="button" className={`${PRIMARY} w-full`} disabled={progress !== null} onClick={() => void submit()}>
          {progress ? "Working..." : "Confirm check-in"}
        </button>
      </div>
    </Panel>
  );
}

function ActiveVisitPanel({
  visit,
  onComplete,
  onAddContact,
}: {
  visit: FieldSalesVisit;
  onComplete: (message: string) => Promise<void>;
  onAddContact: () => void;
}) {
  const [outcome, setOutcome] = useState<(typeof outcomeOptions)[number][0]>("follow_up");
  const [odometerEnd, setOdometerEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [nextActionType, setNextActionType] = useState<(typeof nextActionOptions)[number][0]>("follow_up");
  const [nextActionDueAt, setNextActionDueAt] = useState(localDateInput(1));
  const [nextActionNotes, setNextActionNotes] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFinishing(true);
    const response = await fetch("/api/field-sales/visits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitId: visit.id,
        outcome,
        odometerEndKm: odometerEnd ? Number(odometerEnd) : null,
        notes,
        nextActionType,
        nextActionDueAt: nextActionType === "no_further_action" ? null : nextActionDueAt,
        nextActionNotes,
      }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The visit could not be completed."));
      setFinishing(false);
      return;
    }
    await onComplete("Visit completed.");
  };

  return (
    <Panel className="border-emerald-200 bg-emerald-50/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Active visit</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">{visit.accountName}</h2>
          <p className="mt-1 text-sm text-slate-600">Checked in {formatDateTime(visit.checkedInAt)} · {durationLabel(visit)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${verificationClass(visit)}`}>{verificationLabel(visit)}</span>
      </div>

      <button type="button" onClick={onAddContact} className={`${SECONDARY} mt-4 w-full sm:w-auto`}>Add a contact or business card</button>

      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void finish(event)}>
        <Field label="Visit result">
          <select className={INPUT} value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
            {outcomeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Ending odometer, km (optional)">
          <input className={INPUT} type="number" min={visit.odometerStartKm ?? 0} step="0.1" inputMode="decimal" value={odometerEnd} onChange={(event) => setOdometerEnd(event.target.value)} />
        </Field>
        <label className={`${LABEL} sm:col-span-2`}>Visit notes
          <textarea className={INPUT} rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What happened and what comes next?" />
        </label>
        <Field label="Required next action">
          <select className={INPUT} value={nextActionType} onChange={(event) => setNextActionType(event.target.value as typeof nextActionType)}>
            {nextActionOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </Field>
        {nextActionType !== "no_further_action" && (
          <Field label="Action due date">
            <input className={INPUT} type="date" required min={localDateInput(0)} value={nextActionDueAt} onChange={(event) => setNextActionDueAt(event.target.value)} />
          </Field>
        )}
        <label className={`${LABEL} sm:col-span-2`}>Next-action details
          <textarea className={INPUT} rows={2} maxLength={2000} value={nextActionNotes} onChange={(event) => setNextActionNotes(event.target.value)} placeholder="Who needs what, and what should happen next?" />
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 sm:col-span-2">{error}</p>}
        <button className={`${PRIMARY} sm:col-span-2`} disabled={finishing}>{finishing ? "Completing..." : "Complete visit"}</button>
      </form>
    </Panel>
  );
}

function AppointmentForm({
  accounts,
  onClose,
  onComplete,
}: {
  accounts: FieldSalesAccount[];
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [accountChoice, setAccountChoice] = useState(accounts[0]?.id ?? "new");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("Store visit");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!startsAt) {
      setError("Choose an appointment date and time.");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/field-sales/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: accountChoice === "new" ? null : accountChoice,
        accountName: accountChoice === "new" ? company : undefined,
        address: accountChoice === "new" ? address : undefined,
        title,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        notes,
      }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The appointment could not be saved."));
      setSaving(false);
      return;
    }
    await onComplete("Appointment saved. Add it to Google Calendar from the appointment card.");
  };

  return (
    <Panel className="border-blue-200">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Plan</p><h2 className="mt-1 text-lg font-black text-slate-950">New appointment</h2></div>
        <button type="button" className="min-h-10 px-2 text-sm font-bold text-slate-500" onClick={onClose}>Close</button>
      </div>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <label className={`${LABEL} sm:col-span-2`}>Customer site
          <select className={INPUT} value={accountChoice} onChange={(event) => setAccountChoice(event.target.value)}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.address}</option>)}
            <option value="new">Add a new customer site</option>
          </select>
        </label>
        {accountChoice === "new" && <>
          <Field label="Company"><input className={INPUT} required maxLength={160} value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
          <Field label="Full address"><input className={INPUT} required maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
        </>}
        <label className={`${LABEL} sm:col-span-2`}>Appointment title
          <input className={INPUT} required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <Field label="Starts"><input className={INPUT} required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
        <Field label="Ends (optional)"><input className={INPUT} type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
        <label className={`${LABEL} sm:col-span-2`}>Notes
          <textarea className={INPUT} rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 sm:col-span-2">{error}</p>}
        <button className={`${PRIMARY} sm:col-span-2`} disabled={saving}>{saving ? "Saving..." : "Save appointment"}</button>
      </form>
    </Panel>
  );
}

function WalkInChooser({
  accounts,
  onClose,
  onSelect,
}: {
  accounts: FieldSalesAccount[];
  onClose: () => void;
  onSelect: (account: FieldSalesAccount) => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((item) => item.id === accountId) ?? null;
  return (
    <Panel className="border-blue-200">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Unplanned visit</p><h2 className="mt-1 text-lg font-black text-slate-950">Choose a customer site</h2></div>
        <button type="button" className="min-h-10 px-2 text-sm font-bold text-slate-500" onClick={onClose}>Close</button>
      </div>
      {accounts.length === 0 ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">Add the customer through a new appointment first. The site will then be available for walk-in visits.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <label className={LABEL}>Customer site
            <select className={INPUT} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.address}</option>)}
            </select>
          </label>
          <button type="button" className={`${PRIMARY} w-full`} disabled={!account} onClick={() => account && onSelect(account)}>Continue to check-in</button>
        </div>
      )}
    </Panel>
  );
}

function ContactForm({
  accounts,
  activeVisit,
  initialAccountId,
  onClose,
  onComplete,
}: {
  accounts: FieldSalesAccount[];
  activeVisit: FieldSalesVisit | null;
  initialAccountId: string | null;
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? activeVisit?.accountId ?? accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [card, setCard] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData();
    form.set("accountId", accountId);
    form.set("name", name);
    form.set("jobTitle", jobTitle);
    form.set("email", email);
    form.set("phone", phone);
    form.set("notes", notes);
    if (activeVisit?.accountId === accountId) form.set("visitId", activeVisit.id);
    if (card) form.set("card", card);

    const response = await fetch("/api/field-sales/contacts", { method: "POST", body: form });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The contact could not be saved."));
      setSaving(false);
      return;
    }
    await onComplete("Contact saved.");
  };

  return (
    <Panel className="border-violet-200">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-violet-700">Contact</p><h2 className="mt-1 text-lg font-black text-slate-950">New business contact</h2></div>
        <button type="button" className="min-h-10 px-2 text-sm font-bold text-slate-500" onClick={onClose}>Close</button>
      </div>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
        <label className={`${LABEL} sm:col-span-2`}>Customer site
          <select className={INPUT} required value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="" disabled>Choose a customer site</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <Field label="Name"><input className={INPUT} required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Job title"><input className={INPUT} maxLength={160} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></Field>
        <Field label="Email"><input className={INPUT} type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Phone"><input className={INPUT} type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
        <label className={`${LABEL} sm:col-span-2`}>Business card photo
          <input className={`${INPUT} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-bold file:text-slate-700`} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => setCard(event.target.files?.[0] ?? null)} />
        </label>
        <label className={`${LABEL} sm:col-span-2`}>Notes
          <textarea className={INPUT} rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 sm:col-span-2">{error}</p>}
        <button className={`${PRIMARY} sm:col-span-2`} disabled={saving || !accountId}>{saving ? "Saving..." : "Save contact"}</button>
      </form>
    </Panel>
  );
}

function FollowupCard({
  followup,
  showEmployee,
  onComplete,
}: {
  followup: FieldSalesFollowup;
  showEmployee: boolean;
  onComplete: (message: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const overdue = followup.dueAt != null && followup.dueAt < localDateInput(0);
  const label = nextActionOptions.find(([value]) => value === followup.actionType)?.[1] ?? "Follow up";

  const close = async (status: "completed" | "cancelled") => {
    setSaving(true);
    const response = await fetch("/api/field-sales/followups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followupId: followup.id, status }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setSaving(false);
      window.alert(apiErrorMessage(body, "The follow-up could not be updated."));
      return;
    }
    await onComplete(status === "completed" ? "Next action completed." : "Next action cancelled.");
  };

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${overdue ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-slate-950">{followup.accountName}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-700">{label}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${overdue ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
          {overdue ? "Overdue" : followup.dueAt ? formatShortDate(`${followup.dueAt}T12:00:00`) : "Open"}
        </span>
      </div>
      {showEmployee && <p className="mt-2 text-xs font-bold text-slate-500">{followup.employeeName}</p>}
      {followup.notes && <p className="mt-2 text-xs leading-5 text-slate-600">{followup.notes}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className={PRIMARY} disabled={saving} onClick={() => void close("completed")}>Done</button>
        <button type="button" className="min-h-11 px-3 text-sm font-bold text-slate-500" disabled={saving} onClick={() => void close("cancelled")}>Cancel</button>
      </div>
    </article>
  );
}

function AccountEditor({
  account,
  employees,
  onComplete,
}: {
  account: FieldSalesAccount;
  employees: FieldSalesPayload["employees"];
  onComplete: (message: string) => Promise<void>;
}) {
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(account.assignedEmployeeId ?? "");
  const [territory, setTerritory] = useState(account.territory ?? "");
  const [accountType, setAccountType] = useState(account.accountType);
  const [distributorGroup, setDistributorGroup] = useState(account.distributorGroup ?? "");
  const [lifecycleStatus, setLifecycleStatus] = useState(account.lifecycleStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/field-sales/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        assignedEmployeeId: assignedEmployeeId || null,
        territory,
        accountType,
        distributorGroup,
        lifecycleStatus,
      }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The customer account could not be updated."));
      setSaving(false);
      return;
    }
    await onComplete("Customer ownership updated.");
  };

  return (
    <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
      <Field label="Assigned representative">
        <select className={INPUT} value={assignedEmployeeId} onChange={(event) => setAssignedEmployeeId(event.target.value)}>
          <option value="">Unassigned</option>
          {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
      </Field>
      <Field label="Territory">
        <input className={INPUT} maxLength={120} value={territory} onChange={(event) => setTerritory(event.target.value)} placeholder="GTA West" />
      </Field>
      <Field label="Account type">
        <select className={INPUT} value={accountType} onChange={(event) => setAccountType(event.target.value as typeof accountType)}>
          <option value="prospect">Prospect</option>
          <option value="customer">Existing customer</option>
          <option value="channel_partner">Channel partner</option>
        </select>
      </Field>
      <Field label="Account status">
        <select className={INPUT} value={lifecycleStatus} onChange={(event) => setLifecycleStatus(event.target.value as typeof lifecycleStatus)}>
          <option value="active">Active</option>
          <option value="watch">Needs attention</option>
          <option value="dormant">Dormant</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>
      <label className={`${LABEL} sm:col-span-2`}>Distributor group
        <input className={INPUT} maxLength={160} value={distributorGroup} onChange={(event) => setDistributorGroup(event.target.value)} placeholder="Timber Mart, RONA, Home Hardware..." />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 sm:col-span-2">{error}</p>}
      <button className={`${PRIMARY} sm:col-span-2`} disabled={saving}>{saving ? "Saving..." : "Save customer ownership"}</button>
    </form>
  );
}

function AccountManagementPanel({
  accounts,
  employees,
  onComplete,
}: {
  accounts: FieldSalesAccount[];
  employees: FieldSalesPayload["employees"];
  onComplete: (message: string) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];
  if (!account) return null;
  return (
    <Panel>
      <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage</p><h2 className="mt-1 text-xl font-black text-slate-950">Customer ownership</h2></div>
      <label className={`${LABEL} mt-4`}>Customer site
        <select className={INPUT} value={account.id} onChange={(event) => setAccountId(event.target.value)}>
          {accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.territory || "No territory"}</option>)}
        </select>
      </label>
      <AccountEditor key={account.id} account={account} employees={employees} onComplete={onComplete} />
    </Panel>
  );
}

function AttributionPanel({
  visit,
  onClose,
  onComplete,
}: {
  visit: FieldSalesVisit;
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(visit.accountName);
  const [quotes, setQuotes] = useState<FieldSalesQuoteCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    const response = await fetch(`/api/field-sales/attribution?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "Shopify quotes could not be searched."));
      setSearching(false);
      return;
    }
    const result = body as { quotes?: FieldSalesQuoteCandidate[] };
    setQuotes(result.quotes ?? []);
    setSearching(false);
  };

  const link = async (leadId: string) => {
    setSavingId(leadId);
    setError(null);
    const response = await fetch("/api/field-sales/attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitId: visit.id, leadId }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The quote could not be linked."));
      setSavingId(null);
      return;
    }
    await onComplete("Shopify quote linked to the visit.");
  };

  return (
    <Panel className="border-violet-200">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-violet-700">Visit to revenue</p><h2 className="mt-1 text-xl font-black text-slate-950">Link a Shopify quote</h2><p className="mt-1 text-sm text-slate-600">{visit.accountName} · {visit.employeeName}</p></div>
        <button type="button" className="min-h-10 px-2 text-sm font-bold text-slate-500" onClick={onClose}>Close</button>
      </div>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void search(event)}>
        <label className="sr-only" htmlFor="field-sales-quote-search">Customer, email, phone, or quote number</label>
        <input id="field-sales-quote-search" className={`${INPUT} mt-0`} minLength={2} required value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, email, phone, or quote number" />
        <button className={PRIMARY} disabled={searching}>{searching ? "Searching..." : "Search quotes"}</button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
      <div className="mt-4 space-y-2">
        {!searching && quotes.length === 0 && <p className="text-sm text-slate-500">Search the synchronized Shopify quotation records, then confirm the correct quote.</p>}
        {quotes.map((quote) => (
          <article key={quote.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="text-sm font-black text-slate-950">{quote.draftName} · {formatMoney(quote.quoteAmount)}</p><p className="mt-1 truncate text-xs text-slate-600">{quote.customerName || quote.customerEmail || "No customer name"}{quote.quotedAt ? ` · ${formatShortDate(quote.quotedAt)}` : ""}</p></div>
            {quote.linkedVisitId
              ? <span className="text-xs font-bold text-slate-500">Already linked</span>
              : <button type="button" className={PRIMARY} disabled={savingId !== null} onClick={() => void link(quote.id)}>{savingId === quote.id ? "Linking..." : "Link quote"}</button>}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function AppointmentCard({
  appointment,
  mine,
  busy,
  onCheckIn,
  onCancel,
}: {
  appointment: FieldSalesAppointment;
  mine: boolean;
  busy: boolean;
  onCheckIn: () => void;
  onCancel: () => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-blue-700">{formatDateTime(appointment.startsAt)}</p>
          <h3 className="mt-1 truncate text-base font-black text-slate-950">{appointment.accountName}</h3>
          <p className="mt-0.5 text-sm font-semibold text-slate-700">{appointment.title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{appointment.address}</p>
          {!mine && <p className="mt-1 text-xs font-bold text-slate-500">{appointment.employeeName}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${appointment.hasSitePin ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{appointment.hasSitePin ? "Site verified" : "First visit"}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {mine && appointment.status === "scheduled" && <button type="button" className={PRIMARY} disabled={busy} onClick={onCheckIn}>Check in</button>}
        <a className={SECONDARY} href={appointment.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>
        {mine && appointment.status === "scheduled" && <button type="button" className="min-h-11 px-3 text-sm font-bold text-red-700" onClick={onCancel}>Cancel</button>}
      </div>
    </article>
  );
}

export default function FieldSalesWorkspace({
  initialData,
  initialError,
  initialScope,
}: {
  initialData: FieldSalesPayload | null;
  initialError: string | null;
  initialScope: "mine" | "team";
}) {
  const [data, setData] = useState(initialData);
  const [scope, setScope] = useState<"mine" | "team">(initialData?.scope ?? initialScope);
  const [employeeId, setEmployeeId] = useState(initialData?.selectedEmployeeId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showWalkInChooser, setShowWalkInChooser] = useState(false);
  const [contactAccountId, setContactAccountId] = useState<string | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<CheckInTarget | null>(null);
  const [attributionVisit, setAttributionVisit] = useState<FieldSalesVisit | null>(null);

  const load = async (nextScope = scope, nextEmployeeId = employeeId) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ scope: nextScope });
    if (nextScope === "team" && nextEmployeeId) params.set("employeeId", nextEmployeeId);
    const response = await fetch(`/api/field-sales?${params.toString()}`, { cache: "no-store" });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "Field sales could not be loaded."));
      setLoading(false);
      return;
    }
    setData(body as FieldSalesPayload);
    setLoading(false);
  };

  const complete = async (message: string) => {
    setNotice(message);
    setCheckInTarget(null);
    setShowAppointmentForm(false);
    setShowContactForm(false);
    setShowWalkInChooser(false);
    setAttributionVisit(null);
    await load();
  };

  const switchScope = (nextScope: "mine" | "team") => {
    setScope(nextScope);
    setEmployeeId("");
    setCheckInTarget(null);
    setShowAppointmentForm(false);
    setShowContactForm(false);
    setShowWalkInChooser(false);
    setAttributionVisit(null);
    void load(nextScope, "");
  };

  const switchEmployee = (nextEmployeeId: string) => {
    setEmployeeId(nextEmployeeId);
    void load("team", nextEmployeeId);
  };

  const cancelAppointment = async (appointmentId: string) => {
    if (!window.confirm("Cancel this appointment?")) return;
    const response = await fetch("/api/field-sales/appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId, status: "cancelled" }),
    });
    const body = await responseJson(response);
    if (!response.ok) {
      setError(apiErrorMessage(body, "The appointment could not be cancelled."));
      return;
    }
    await complete("Appointment cancelled.");
  };

  const upcoming = useMemo(() => (data?.appointments ?? []).filter((appointment) =>
    appointment.status === "scheduled" || appointment.status === "in_progress"
  ).slice(0, 12), [data]);
  const activeTeamVisits = useMemo(() => (data?.visits ?? []).filter((visit) => visit.status === "open"), [data]);
  const recentVisits = useMemo(() => (data?.visits ?? []).filter((visit) => visit.status === "completed").slice(0, 20), [data]);
  const openFollowups = useMemo(() => (data?.followups ?? []).filter((followup) => followup.status === "open"), [data]);
  const revenueByVisit = useMemo(() => {
    const result = new Map<string, FieldSalesPayload["revenueLinks"]>();
    for (const link of data?.revenueLinks ?? []) {
      const links = result.get(link.visitId) ?? [];
      links.push(link);
      result.set(link.visitId, links);
    }
    return result;
  }, [data]);

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <Panel><h1 className="text-2xl font-black text-slate-950">Field sales</h1><p className="mt-3 text-sm text-red-700">{error ?? "Field sales could not be loaded."}</p><button className={`${PRIMARY} mt-5`} disabled={loading} onClick={() => void load()}>{loading ? "Loading..." : "Try again"}</button></Panel>
      </div>
    );
  }

  const mine = scope === "mine";
  const canCreate = mine && data.viewer.canCreatePersonalActivity;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Field sales</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">On the road</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Plan customer visits, check in with one location snapshot, record mileage, and keep the contacts that move each opportunity forward.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/clock" className={SECONDARY}>Work clock</a>
          {data.viewer.canManage && (
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Field sales view">
              {data.viewer.canCreatePersonalActivity && <button type="button" className={`min-h-10 rounded-lg px-4 text-sm font-bold ${mine ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => switchScope("mine")}>My work</button>}
              <button type="button" className={`min-h-10 rounded-lg px-4 text-sm font-bold ${!mine ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => switchScope("team")}>Team</button>
            </div>
          )}
        </div>
      </header>

      {notice && <div role="status" className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</div>}

      {!mine && (
        <Panel>
          <label className={LABEL}>Sales representative
            <select className={`${INPUT} sm:max-w-sm`} value={employeeId} onChange={(event) => switchEmployee(event.target.value)}>
              <option value="">All field sales</option>
              {data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={data.stats.appointmentsToday} detail="appointments" />
        <Stat label="Visits" value={data.stats.completedVisits} detail="completed in 90 days" />
        <Stat label="Mileage" value={data.stats.mileageKm.toLocaleString("en-CA", { maximumFractionDigits: 1 })} detail="km recorded" />
        <Stat label="Contacts" value={data.stats.contacts} detail="captured" />
        <Stat label="Next actions" value={data.stats.openFollowups} detail={`${data.stats.overdueFollowups} overdue`} />
        <Stat label="Linked quotes" value={data.stats.attributedQuotes} detail="from field visits" />
        <Stat label="Won orders" value={data.stats.attributedOrders} detail={data.stats.attributedQuotes ? `${Math.round((data.stats.attributedOrders / data.stats.attributedQuotes) * 100)}% conversion` : "No linked quotes yet"} />
        <Stat label="Revenue" value={formatMoney(data.stats.attributedRevenue)} detail="won after visits" />
      </div>

      {!mine && activeTeamVisits.length > 0 && (
        <Panel className="border-emerald-200 bg-emerald-50/30">
          <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Live activity</p><h2 className="mt-1 text-xl font-black text-slate-950">Active visits</h2></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {activeTeamVisits.map((visit) => (
              <article key={visit.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-black text-slate-950">{visit.employeeName}</h3><p className="mt-0.5 text-sm font-semibold text-slate-700">{visit.accountName}</p></div><span className="text-xs font-bold text-emerald-700">{durationLabel(visit)}</span></div>
                <p className="mt-2 text-xs text-slate-500">Checked in {formatDateTime(visit.checkedInAt)}</p>
                <p className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ring-1 ${verificationClass(visit)}`}>{verificationLabel(visit)}</p>
              </article>
            ))}
          </div>
        </Panel>
      )}

      {canCreate && data.activeVisit && <ActiveVisitPanel visit={data.activeVisit} onComplete={complete} onAddContact={() => { setContactAccountId(data.activeVisit?.accountId ?? null); setShowContactForm(true); }} />}
      {checkInTarget && <CheckInPanel target={checkInTarget} onClose={() => setCheckInTarget(null)} onComplete={complete} />}
      {attributionVisit && <AttributionPanel visit={attributionVisit} onClose={() => setAttributionVisit(null)} onComplete={complete} />}
      {showWalkInChooser && <WalkInChooser accounts={data.accounts} onClose={() => setShowWalkInChooser(false)} onSelect={(account) => { setShowWalkInChooser(false); setCheckInTarget({ appointmentId: null, accountId: account.id, accountName: account.name, address: account.address, hasSitePin: account.hasSitePin }); }} />}
      {showAppointmentForm && <AppointmentForm accounts={data.accounts} onClose={() => setShowAppointmentForm(false)} onComplete={complete} />}
      {showContactForm && <ContactForm accounts={data.accounts} activeVisit={data.activeVisit} initialAccountId={contactAccountId} onClose={() => setShowContactForm(false)} onComplete={complete} />}

      {canCreate && !showAppointmentForm && !showContactForm && !showWalkInChooser && !checkInTarget && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button type="button" className={`${PRIMARY} min-h-14`} disabled={Boolean(data.activeVisit)} onClick={() => setShowWalkInChooser(true)}>Check in now</button>
          <button type="button" className={`${SECONDARY} min-h-14`} onClick={() => setShowAppointmentForm(true)}>New appointment</button>
          <button type="button" className={`${SECONDARY} col-span-2 min-h-14 sm:col-span-1`} onClick={() => { setContactAccountId(null); setShowContactForm(true); }}>Add contact</button>
        </div>
      )}

      {openFollowups.length > 0 && (
        <section>
          <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Commitments</p><h2 className="mt-1 text-xl font-black text-slate-950">Next actions</h2><p className="mt-1 text-sm text-slate-600">Close the loop on every customer visit.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {openFollowups.map((followup) => <FollowupCard key={followup.id} followup={followup} showEmployee={!mine} onComplete={complete} />)}
          </div>
        </section>
      )}

      {!mine && data.viewer.canManage && <AccountManagementPanel accounts={data.accounts} employees={data.employees} onComplete={complete} />}

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Schedule</p><h2 className="mt-1 text-xl font-black text-slate-950">Upcoming appointments</h2></div>
            {loading && <span className="text-xs font-bold text-blue-700">Refreshing...</span>}
          </div>
          <div className="space-y-3">
            {upcoming.length === 0 ? <EmptyState>No upcoming appointments. {canCreate ? "Add one before your next route." : "Scheduled visits will appear here."}</EmptyState> : upcoming.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                mine={mine}
                busy={Boolean(data.activeVisit)}
                onCheckIn={() => setCheckInTarget({
                  appointmentId: appointment.id,
                  accountId: appointment.accountId,
                  accountName: appointment.accountName,
                  address: appointment.address,
                  hasSitePin: appointment.hasSitePin,
                })}
                onCancel={() => void cancelAppointment(appointment.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Activity</p><h2 className="mt-1 text-xl font-black text-slate-950">Recent visits</h2></div>
          <div className="space-y-3">
            {recentVisits.length === 0 ? <EmptyState>Completed visits will appear here with their outcome and location status.</EmptyState> : recentVisits.map((visit) => (
              <article key={visit.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-950">{visit.accountName}</h3><p className="mt-1 text-xs text-slate-500">{formatShortDate(visit.checkedInAt)} · {durationLabel(visit)}{!mine ? ` · ${visit.employeeName}` : ""}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ring-1 ${verificationClass(visit)}`}>{verificationLabel(visit)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span className="font-semibold">{outcomeOptions.find(([value]) => value === visit.outcome)?.[1] ?? "No outcome"}</span>
                  {visit.mileageKm != null && <span>{visit.mileageKm.toLocaleString("en-CA")} km</span>}
                </div>
                {visit.notes && <p className="mt-2 text-xs leading-5 text-slate-600">{visit.notes}</p>}
                {(revenueByVisit.get(visit.id) ?? []).map((link) => (
                  <div key={link.id} className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <p className="font-black">{link.quoteName} · {formatMoney(link.quoteAmount)}</p>
                    <p className="mt-0.5 font-semibold">{link.leadStatus === "won" ? "Won order" : "Open quote"}{link.customerName ? ` · ${link.customerName}` : ""}</p>
                  </div>
                ))}
                {!mine && data.viewer.canManage && (
                  <button type="button" className={`${SECONDARY} mt-3 w-full`} onClick={() => setAttributionVisit(visit)}>Link Shopify quote</button>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section>
        <div className="mb-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Relationships</p><h2 className="mt-1 text-xl font-black text-slate-950">Recent contacts</h2></div>
        {data.contacts.length === 0 ? <EmptyState>Contacts and business cards will appear here.</EmptyState> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.contacts.slice(0, 12).map((contact) => (
              <article key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-950">{contact.name}</h3><p className="mt-0.5 truncate text-xs font-semibold text-slate-600">{contact.jobTitle || contact.accountName}</p></div>{contact.cardUrl && <a className="shrink-0 text-xs font-bold text-blue-700" href={contact.cardUrl} target="_blank" rel="noreferrer">View card</a>}</div>
                <p className="mt-2 text-xs font-bold text-slate-500">{contact.accountName}{!mine ? ` · ${contact.employeeName}` : ""}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-600">{contact.email && <a className="block truncate text-blue-700" href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phone && <a className="block text-blue-700" href={`tel:${contact.phone}`}>{contact.phone}</a>}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

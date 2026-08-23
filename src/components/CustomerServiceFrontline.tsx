"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useNativeRuntime } from "@/components/NativeAppRuntime";
import type {
  CustomerServiceQueueState,
  PersonalCallback,
  PersonalFollowup,
  QueueAction,
  QueueItemType,
} from "@/lib/customer-service-queue";

function money(value: number | string | null) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function dateLabel(value: string | null) {
  if (!value) return "No date set";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function QueueSection({
  id,
  title,
  items,
  type,
  available = false,
  connected,
  onUpdate,
}: {
  id: string;
  title: string;
  items: Array<PersonalCallback | PersonalFollowup>;
  type: QueueItemType;
  available?: boolean;
  connected: boolean;
  onUpdate: (
    type: QueueItemType,
    action: QueueAction,
    item: PersonalCallback | PersonalFollowup,
  ) => void;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`} className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing in this queue.</p>
        ) : items.map((item) => {
          const callback = type === "callback" ? item as PersonalCallback : null;
          const followup = type === "followup" ? item as PersonalFollowup : null;
          const key = callback ? `${callback.store_id}:${callback.from_number}` : followup!.id;
          return (
            <div key={key} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-950">{callback?.from_number ?? followup?.customer_name ?? followup?.draft_name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{callback ? callback.note || "Callback needs a response" : `${dateLabel(followup!.next_followup_at)} · ${money(followup!.quote_amount)}`}</span>
              </span>
              <button
                type="button"
                disabled={!connected}
                onClick={() => onUpdate(type, available ? "claim" : "release", item)}
                className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-bold ${available ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600"}`}
              >
                {available ? "Claim" : "Release"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function CustomerServiceFrontline({ viewerEmail }: { viewerEmail: string }) {
  const { connected } = useNativeRuntime();
  const { data, error, isLoading, mutate } = useSWR<CustomerServiceQueueState>("/api/mobile/customer-service");
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 7);
  const toDateString = today.toISOString().slice(0, 10);
  const fromDateString = fromDate.toISOString().slice(0, 10);
  const rfCallbacks = useSWR<{ callbacks: Array<PersonalCallback & { note_status?: string }> }>(
    `/api/customer-service?view=callbacks&store=rf_transparent&from=${fromDateString}&to=${toDateString}`,
  );
  const bcCallbacks = useSWR<{ callbacks: Array<PersonalCallback & { note_status?: string }> }>(
    `/api/customer-service?view=callbacks&store=bc_transparent&from=${fromDateString}&to=${toDateString}`,
  );
  const callbacks = [
    ...(rfCallbacks.data?.callbacks ?? []).map((item) => ({ ...item, store_id: "rf_transparent", status: item.note_status ?? item.status ?? null, updated_at: item.last_call ?? null })),
    ...(bcCallbacks.data?.callbacks ?? []).map((item) => ({ ...item, store_id: "bc_transparent", status: item.note_status ?? item.status ?? null, updated_at: item.last_call ?? null })),
  ];
  const followups = data?.followups ?? [];
  const mineCallbacks = callbacks.filter((item) => item.assigned_to === viewerEmail);
  const openCallbacks = callbacks.filter((item) => !item.assigned_to);
  const mineFollowups = followups.filter((item) => item.assigned_to === viewerEmail);
  const openFollowups = followups.filter((item) => !item.assigned_to);
  const [assignmentPending, setAssignmentPending] = useState(false);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentSuccess, setAssignmentSuccess] = useState("");

  async function updateAssignment(
    type: QueueItemType,
    action: QueueAction,
    item: PersonalCallback | PersonalFollowup,
  ) {
    if (!connected || assignmentPending) return;
    setAssignmentPending(true);
    setAssignmentError("");
    setAssignmentSuccess("");
    try {
      const response = await fetch("/api/mobile/customer-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "callback"
          ? { type, action, storeId: (item as PersonalCallback).store_id, phone: (item as PersonalCallback).from_number }
          : { type, action, id: (item as PersonalFollowup).id }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Could not update this assignment.");
      }
      setAssignmentSuccess(action === "claim" ? "Work assigned to you." : "Work returned to the available queue.");
      await mutate();
      await Promise.all([rfCallbacks.mutate(), bcCallbacks.mutate()]);
    } catch (updateError) {
      setAssignmentError(updateError instanceof Error ? updateError.message : "Could not update this assignment.");
    } finally {
      setAssignmentPending(false);
    }
  }

  if (isLoading && !data) {
    return <div className="mx-auto max-w-4xl space-y-4" role="status" aria-label="Loading personal customer-service queue"><div className="h-20 animate-pulse rounded-2xl bg-slate-200" /><div className="h-64 animate-pulse rounded-2xl bg-white" /></div>;
  }
  if (error && !data) {
    return <div className="mx-auto max-w-lg rounded-3xl border border-red-200 bg-white p-6 text-center" role="alert"><h1 className="text-xl font-bold text-slate-950">Your queue could not load</h1><p className="mt-2 text-sm text-slate-600">{error.message}</p><button onClick={() => void mutate()} className="mt-5 min-h-12 w-full rounded-2xl bg-blue-600 px-4 py-3 font-bold text-white">Try again</button></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-600">Customer service</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">My service queue</h1>
        <p className="mt-2 text-sm text-slate-500">Your callbacks and customer follow-ups come first.</p>
      </header>
      {!connected && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">You are offline. Queue assignments cannot change until you reconnect.</p>}
      {assignmentPending && <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900" role="status">Updating assignment...</p>}
      {assignmentError && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert" aria-live="assertive">{assignmentError}</p>}
      {assignmentSuccess && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status" aria-live="polite">{assignmentSuccess}</p>}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-4 py-4"><p className="text-2xl font-bold text-slate-950">{mineCallbacks.length}</p><p className="text-xs font-semibold text-slate-500">My callbacks</p></div>
        <div className="border-l border-slate-100 px-4 py-4"><p className="text-2xl font-bold text-slate-950">{mineFollowups.length}</p><p className="text-xs font-semibold text-slate-500">My follow-ups</p></div>
      </div>
      <QueueSection id="callbacks" title="My callbacks" items={mineCallbacks} type="callback" connected={connected && !assignmentPending} onUpdate={(type, action, item) => void updateAssignment(type, action, item)} />
      <QueueSection id="followups" title="My follow-ups" items={mineFollowups} type="followup" connected={connected && !assignmentPending} onUpdate={(type, action, item) => void updateAssignment(type, action, item)} />
      {(openCallbacks.length > 0 || openFollowups.length > 0) && (
        <details className="rounded-2xl border border-slate-200 bg-white">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between px-4 py-3 text-sm font-bold text-slate-800">Available work <span className="text-slate-400">{openCallbacks.length + openFollowups.length}</span></summary>
          <div className="space-y-4 border-t border-slate-100 p-3">
            <QueueSection id="available-callbacks" title="Available callbacks" items={openCallbacks} type="callback" available connected={connected && !assignmentPending} onUpdate={(type, action, item) => void updateAssignment(type, action, item)} />
            <QueueSection id="available-followups" title="Available follow-ups" items={openFollowups} type="followup" available connected={connected && !assignmentPending} onUpdate={(type, action, item) => void updateAssignment(type, action, item)} />
          </div>
        </details>
      )}
      <section aria-label="Team analytics" className="grid gap-2 sm:grid-cols-2">
        <Link href="/customer-service/phones" className="flex min-h-14 items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">Phone analytics <span aria-hidden="true">›</span></Link>
        <Link href="/customer-service/follow-up" className="flex min-h-14 items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">Follow-up analytics <span aria-hidden="true">›</span></Link>
      </section>
    </div>
  );
}

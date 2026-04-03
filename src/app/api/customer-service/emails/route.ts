import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";
import { INBOXES, listMessages, classifyDirection, extractEmail } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function pctChange(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
}

interface EmailRecord {
  message_id: string;
  thread_id: string;
  store_id: string;
  inbox: string;
  direction: "inbound" | "outbound";
  from_email: string;
  to_email: string;
  subject: string;
  received_at: string;
  snippet: string;
}

// --- Noise sender detection ---
// Prefix patterns: if the local part (before @) starts with any of these, it's noise
const NOISE_PREFIXES = [
  "noreply", "no-reply", "no_reply", "no.reply",
  "donotreply", "do-not-reply", "do_not_reply",
  "nepasrepondre", "ne-pas-repondre", "sansreponse", "sans-reponse",
  "mailer-daemon", "postmaster",
];

// Domain patterns: if the sender domain matches (exact or subdomain), it's noise
const NOISE_DOMAINS = [
  // Security / alarm systems
  "alarm.com",
  // Telecom notifications
  "external.telus.com", "connect.telus.com", "business.telus.com",
  // Social media
  "facebookmail.com",
  "em.linkedin.com", "linkedin.com",
  "marketing.pinterest.com", "info.pinterest.com", "discover.pinterest.com", "explore.pinterest.com",
  "service.tiktok.com",
  // Job boards
  "jobalert.indeed.com", "indeedemail.com",
  // Marketplaces
  "member.alibaba.com", "service.alibaba.com", "buynotice.alibaba.com",
  "g.shopifyemail.com",
  // Travel / marketing
  "eg.expedia.com", "eg.vrbo.com",
  "mail.aircanada.com",
  "newsletter.croisieres.fr", "newsletter.croisierenet.com",
  // Payment notifications
  "payments.interac.ca",
  "news.paypal.com",
  // Google automated
  "googlemail.com",
  // SaaS notifications
  "shop.app",
  "mail.notion.so",
  "m.grasshopper.com",
  // Marketing platforms
  "hs-send.com",
  "ccsend.com",
  "cyberimpact.com",
  "marketplaceevents.messages5.com",
  "kajabimail.net",
  // Tools / newsletters
  "mail.reportpundit.com",
  "edit.houzz.com",
  "email.clover.com", "mail.clover.com",
  "email.heygen.com",
  "newsletter.artlist.io",
  "marketing.descript.com",
  "cmail.bark.com",
  "account.onstar.ca",
  "mail.aircanada.com",
];

// Prefix patterns in the domain part that indicate noise (e.g. ads-noreply@google.com)
const NOISE_DOMAIN_PREFIXES = ["noreply@", "no-reply@", "ads-noreply@", "workspace-noreply@", "notifications-noreply@", "messages-noreply@", "googledev-noreply@", "iebilling-no_reply@"];

/**
 * Returns true if the sender email is automated/marketing noise that doesn't need a response.
 */
function isNoiseSender(email: string): boolean {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx < 0) return false;

  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Check local part prefix patterns
  for (const prefix of NOISE_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + "+") || local.startsWith(prefix + ".")) return true;
    // Also catch exact prefix match (noreply@...)
    if (local === prefix) return true;
  }

  // Check for -noreply or _noreply suffix in local part (e.g. ads-noreply, iebilling-no_reply)
  if (/-noreply$/i.test(local) || /_noreply$/i.test(local) || /-no[_-]reply$/i.test(local)) return true;

  // Check the full email against domain prefix patterns
  for (const dp of NOISE_DOMAIN_PREFIXES) {
    if (lower.includes(dp)) return true;
  }

  // Check domain patterns (exact match or subdomain)
  for (const nd of NOISE_DOMAINS) {
    if (domain === nd || domain.endsWith("." + nd)) return true;
  }

  return false;
}

function computeMetrics(records: EmailRecord[], dismissedThreadIds?: Set<string>) {
  const inbound = records.filter((r) => r.direction === "inbound");
  const outbound = records.filter((r) => r.direction === "outbound");

  // Group by thread to determine answered/unanswered
  const threadMap = new Map<string, { firstInbound: string | null; firstOutbound: string | null; firstInboundFrom: string }>();
  for (const r of records) {
    const thread = threadMap.get(r.thread_id) ?? { firstInbound: null, firstOutbound: null, firstInboundFrom: "" };
    if (r.direction === "inbound" && (!thread.firstInbound || r.received_at < thread.firstInbound)) {
      thread.firstInbound = r.received_at;
      thread.firstInboundFrom = r.from_email;
    }
    if (r.direction === "outbound" && (!thread.firstOutbound || r.received_at < thread.firstOutbound)) {
      thread.firstOutbound = r.received_at;
    }
    threadMap.set(r.thread_id, thread);
  }

  // Threads that have at least one inbound message
  const inboundThreads = [...threadMap.entries()].filter(([, t]) => t.firstInbound);

  // Actionable threads: exclude noise senders and dismissed threads
  const actionableThreads = inboundThreads.filter(([id, t]) => {
    if (isNoiseSender(t.firstInboundFrom)) return false;
    if (dismissedThreadIds?.has(id)) return false;
    return true;
  });
  const noiseThreadCount = inboundThreads.filter(([, t]) => isNoiseSender(t.firstInboundFrom)).length;
  const dismissedThreadCount = inboundThreads.filter(([id, t]) => !isNoiseSender(t.firstInboundFrom) && dismissedThreadIds?.has(id)).length;

  const answeredThreads = actionableThreads.filter(([, t]) => t.firstOutbound && t.firstOutbound > t.firstInbound!);
  const unansweredThreads = actionableThreads.filter(([, t]) => !t.firstOutbound || t.firstOutbound <= t.firstInbound!);

  // Response times (in minutes) — only from actionable answered threads
  const responseTimes: number[] = [];
  for (const [, t] of answeredThreads) {
    if (t.firstInbound && t.firstOutbound) {
      const diffMin = (new Date(t.firstOutbound).getTime() - new Date(t.firstInbound).getTime()) / 60000;
      if (diffMin > 0) responseTimes.push(diffMin);
    }
  }

  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length)
    : null;

  const unansweredRate = actionableThreads.length > 0
    ? Math.round((unansweredThreads.length / actionableThreads.length) * 1000) / 10
    : 0;

  const responseRate = actionableThreads.length > 0
    ? Math.round((answeredThreads.length / actionableThreads.length) * 1000) / 10
    : 0;

  return {
    total_inbound: inbound.length,
    total_outbound: outbound.length,
    inbound_threads: actionableThreads.length,
    answered_threads: answeredThreads.length,
    unanswered_threads: unansweredThreads.length,
    unanswered_rate: unansweredRate,
    response_rate: responseRate,
    avg_response_time: avgResponseTime,
    noise_threads: noiseThreadCount,
    dismissed_threads: dismissedThreadCount,
    total_threads_raw: inboundThreads.length,
  };
}

async function fetchRecords(from: string, to: string, storeId: string): Promise<EmailRecord[]> {
  const supabase = getSupabase();
  const allRecords: EmailRecord[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("email_messages")
      .select("*")
      .eq("store_id", storeId)
      .gte("received_at", from + "T00:00:00")
      .lt("received_at", to + "T23:59:59")
      .order("received_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    allRecords.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allRecords;
}

const STORES = INBOXES.map((i) => ({ id: i.storeId, label: i.label }));

async function fetchDismissedThreadIds(inbox: string): Promise<Set<string>> {
  const { data } = await getSupabase()
    .from("email_dismissed_threads")
    .select("thread_id")
    .eq("inbox", inbox);
  return new Set((data ?? []).map((r: { thread_id: string }) => r.thread_id));
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const view = req.nextUrl.searchParams.get("view");
  const storeId = req.nextUrl.searchParams.get("store") || STORES[0].id;
  const today = toDateStr(new Date());
  const from = req.nextUrl.searchParams.get("from") || today;
  const to = req.nextUrl.searchParams.get("to") || today;

  if (view === "stores") {
    return NextResponse.json({ stores: STORES });
  }

  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));

  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - rangeDays);
  const prevFromStr = toDateStr(prevFrom);
  const prevToStr = toDateStr(prevTo);

  // Last sync info
  const { data: lastRunRow } = await getSupabase()
    .from("email_sync_runs")
    .select("*")
    .eq("inbox", INBOXES.find((i) => i.storeId === storeId)?.email ?? "")
    .order("started_at", { ascending: false })
    .limit(1);

  const lastSync = lastRunRow?.[0] ? {
    status: lastRunRow[0].status,
    finishedAt: lastRunRow[0].finished_at,
    messagesSynced: lastRunRow[0].messages_synced,
    errorMessage: lastRunRow[0].error_message,
  } : null;

  const inboxEmail = INBOXES.find((i) => i.storeId === storeId)?.email ?? "";
  const dismissedIds = await fetchDismissedThreadIds(inboxEmail);

  try {
    // --- Unanswered threads view ---
    if (view === "threads") {
      const filter = req.nextUrl.searchParams.get("filter"); // "actionable" (default) | "noise" | "dismissed" | "all"
      const records = await fetchRecords(from, to, storeId);

      // Group by thread
      const threadMap = new Map<string, EmailRecord[]>();
      for (const r of records) {
        const arr = threadMap.get(r.thread_id) ?? [];
        arr.push(r);
        threadMap.set(r.thread_id, arr);
      }

      const unanswered: { thread_id: string; subject: string; from_email: string; received_at: string; message_count: number; snippet: string; is_noise: boolean; is_dismissed: boolean }[] = [];

      for (const [threadId, msgs] of threadMap) {
        const inbound = msgs.filter((m) => m.direction === "inbound").sort((a, b) => a.received_at.localeCompare(b.received_at));
        const outbound = msgs.filter((m) => m.direction === "outbound");

        if (inbound.length === 0) continue;
        const firstIn = inbound[0];
        const hasReply = outbound.some((o) => o.received_at > firstIn.received_at);

        if (!hasReply) {
          const noise = isNoiseSender(firstIn.from_email);
          const dismissed = dismissedIds.has(threadId);

          unanswered.push({
            thread_id: threadId,
            subject: firstIn.subject,
            from_email: firstIn.from_email,
            received_at: firstIn.received_at,
            message_count: msgs.length,
            snippet: firstIn.snippet,
            is_noise: noise,
            is_dismissed: dismissed,
          });
        }
      }

      unanswered.sort((a, b) => b.received_at.localeCompare(a.received_at));

      // Apply filter
      let filtered = unanswered;
      if (filter === "noise") {
        filtered = unanswered.filter((t) => t.is_noise);
      } else if (filter === "dismissed") {
        filtered = unanswered.filter((t) => t.is_dismissed && !t.is_noise);
      } else if (filter === "all") {
        // no filtering
      } else {
        // "actionable" (default): exclude noise and dismissed
        filtered = unanswered.filter((t) => !t.is_noise && !t.is_dismissed);
      }

      const counts = {
        actionable: unanswered.filter((t) => !t.is_noise && !t.is_dismissed).length,
        noise: unanswered.filter((t) => t.is_noise).length,
        dismissed: unanswered.filter((t) => t.is_dismissed && !t.is_noise).length,
        total: unanswered.length,
      };

      return NextResponse.json({ threads: filtered, counts, lastSync });
    }

    // --- History view ---
    if (view === "history") {
      const records = await fetchRecords(from, to, storeId);
      const byDate = new Map<string, { inbound: number; outbound: number }>();

      // Pre-fill dates
      const rangeStart = new Date(from + "T00:00:00");
      const rangeEnd = new Date(to + "T00:00:00");
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        byDate.set(d.toISOString().split("T")[0], { inbound: 0, outbound: 0 });
      }

      for (const r of records) {
        const d = r.received_at.split("T")[0];
        const day = byDate.get(d) ?? { inbound: 0, outbound: 0 };
        if (r.direction === "inbound") day.inbound++;
        else day.outbound++;
        byDate.set(d, day);
      }

      const history = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, day]) => ({ date, ...day, total: day.inbound + day.outbound }));

      return NextResponse.json({ history, lastSync });
    }

    // --- Summary view (default) ---
    const [currentRecords, previousRecords] = await Promise.all([
      fetchRecords(from, to, storeId),
      fetchRecords(prevFromStr, prevToStr, storeId),
    ]);

    const current = computeMetrics(currentRecords, dismissedIds);
    const previous = computeMetrics(previousRecords, dismissedIds);

    return NextResponse.json({
      current,
      previous,
      change: {
        total_inbound: pctChange(current.total_inbound, previous.total_inbound),
        total_outbound: pctChange(current.total_outbound, previous.total_outbound),
        unanswered_rate: pctChange(current.unanswered_rate, previous.unanswered_rate),
        response_rate: pctChange(current.response_rate, previous.response_rate),
        avg_response_time: pctChange(current.avg_response_time ?? 0, previous.avg_response_time ?? 0),
      },
      dateRange: {
        current: { from, to },
        previous: { from: prevFromStr, to: prevToStr },
      },
      lastSync,
      stores: STORES,
    });
  } catch (err) {
    console.error("[Email API]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch email data" },
      { status: 500 },
    );
  }
}

// POST: trigger email sync for a specific inbox
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const storeId = req.nextUrl.searchParams.get("store") || STORES[0].id;
  const inbox = INBOXES.find((i) => i.storeId === storeId);
  if (!inbox) {
    return NextResponse.json({ error: `Unknown store: ${storeId}` }, { status: 400 });
  }

  const supabase = getSupabase();
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  await supabase.from("email_sync_runs").insert({
    id: runId,
    inbox: inbox.email,
    started_at: now,
    status: "running",
  });

  try {
    // Fetch emails — default 14 days, backfill=true pulls 90 days
    const backfill = req.nextUrl.searchParams.get("backfill") === "true";
    const daysBack = backfill ? 90 : 14;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);
    const afterEpoch = Math.floor(sinceDate.getTime() / 1000);

    const messages = await listMessages(inbox, `after:${afterEpoch}`, backfill ? 2000 : 500);

    const records: EmailRecord[] = messages.map((msg) => ({
      message_id: msg.id,
      thread_id: msg.threadId,
      store_id: inbox.storeId,
      inbox: inbox.email,
      direction: classifyDirection(msg, inbox.email),
      from_email: extractEmail(msg.from),
      to_email: extractEmail(msg.to),
      subject: msg.subject,
      received_at: new Date(msg.date).toISOString(),
      snippet: msg.snippet.slice(0, 500),
    }));

    // Upsert to avoid duplicates
    if (records.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const { error } = await supabase
          .from("email_messages")
          .upsert(batch, { onConflict: "message_id,inbox" });
        if (error) throw new Error(error.message);
      }
    }

    await supabase.from("email_sync_runs").update({
      status: "success",
      finished_at: new Date().toISOString(),
      messages_synced: records.length,
    }).eq("id", runId);

    return NextResponse.json({
      status: "success",
      messages_synced: records.length,
      inbox: inbox.email,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    await supabase.from("email_sync_runs").update({
      status: "error",
      finished_at: new Date().toISOString(),
      error_message: errMsg.slice(0, 500),
    }).eq("id", runId);

    return NextResponse.json({ status: "error", error: errMsg }, { status: 500 });
  }
}

// PATCH: dismiss or undismiss a thread
export async function PATCH(req: NextRequest) {
  if (!(await isAuthenticated()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { thread_id, inbox, action } = body as { thread_id: string; inbox: string; action: "dismiss" | "undismiss" };

  if (!thread_id || !inbox) {
    return NextResponse.json({ error: "thread_id and inbox required" }, { status: 400 });
  }

  const supabase = getSupabase();

  if (action === "undismiss") {
    await supabase.from("email_dismissed_threads").delete().eq("thread_id", thread_id).eq("inbox", inbox);
    return NextResponse.json({ status: "undismissed", thread_id });
  }

  // Default: dismiss
  const { error } = await supabase
    .from("email_dismissed_threads")
    .upsert({ thread_id, inbox, dismissed_at: new Date().toISOString() }, { onConflict: "thread_id,inbox" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "dismissed", thread_id });
}

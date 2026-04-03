import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { INBOXES, listMessages, classifyDirection, extractEmail } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const results: { inbox: string; status: string; count?: number; error?: string }[] = [];

  for (const inbox of INBOXES) {
    // Skip if no refresh token configured
    if (!process.env[inbox.refreshTokenEnv]) {
      results.push({ inbox: inbox.email, status: "skipped", error: `${inbox.refreshTokenEnv} not set` });
      continue;
    }

    const runId = crypto.randomUUID();
    await supabase.from("email_sync_runs").insert({
      id: runId,
      inbox: inbox.email,
      started_at: new Date().toISOString(),
      status: "running",
    });

    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const afterEpoch = Math.floor(sevenDaysAgo.getTime() / 1000);

      const messages = await listMessages(inbox, `after:${afterEpoch}`, 500);

      const records = messages.map((msg) => ({
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

      if (records.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < records.length; i += BATCH) {
          const { error } = await supabase
            .from("email_messages")
            .upsert(records.slice(i, i + BATCH), { onConflict: "message_id,inbox" });
          if (error) throw new Error(error.message);
        }
      }

      await supabase.from("email_sync_runs").update({
        status: "success",
        finished_at: new Date().toISOString(),
        messages_synced: records.length,
      }).eq("id", runId);

      results.push({ inbox: inbox.email, status: "success", count: records.length });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await supabase.from("email_sync_runs").update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: errMsg.slice(0, 500),
      }).eq("id", runId);

      results.push({ inbox: inbox.email, status: "error", error: errMsg });
    }
  }

  console.log("[Cron sync-emails]", JSON.stringify(results));
  return NextResponse.json({ results, synced_at: new Date().toISOString() });
}

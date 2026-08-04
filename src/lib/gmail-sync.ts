import { getSupabase } from "@/lib/supabase";
import {
  classifyDirection,
  extractEmail,
  listMessages,
  type GmailInbox,
} from "@/lib/gmail";

export interface GmailSyncResult {
  inbox: string;
  status: "success" | "error";
  count?: number;
  error?: string;
}

export async function syncGmailInbox(inbox: GmailInbox): Promise<GmailSyncResult> {
  const supabase = getSupabase();
  const runId = crypto.randomUUID();
  await supabase.from("email_sync_runs").insert({
    id: runId,
    inbox: inbox.email,
    started_at: new Date().toISOString(),
    status: "running",
  });

  try {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 14);
    const afterEpoch = Math.floor(sinceDate.getTime() / 1000);
    const messages = await listMessages(inbox, `after:${afterEpoch}`, 500);

    const records = messages.map((message) => ({
      message_id: message.id,
      thread_id: message.threadId,
      store_id: inbox.storeId,
      inbox: inbox.email,
      direction: classifyDirection(message, inbox.email),
      from_email: extractEmail(message.from),
      to_email: extractEmail(message.to),
      subject: message.subject,
      received_at: new Date(message.date).toISOString(),
      snippet: message.snippet.slice(0, 500),
    }));

    const batchSize = 100;
    for (let index = 0; index < records.length; index += batchSize) {
      const { error } = await supabase
        .from("email_messages")
        .upsert(records.slice(index, index + batchSize), { onConflict: "message_id,inbox" });
      if (error) throw new Error(error.message);
    }

    await supabase
      .from("email_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        messages_synced: records.length,
      })
      .eq("id", runId);

    return { inbox: inbox.email, status: "success", count: records.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("email_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: message.slice(0, 500),
      })
      .eq("id", runId);
    return { inbox: inbox.email, status: "error", error: message };
  }
}

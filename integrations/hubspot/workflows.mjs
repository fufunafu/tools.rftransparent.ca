// Resumable local indexing/file migration. Does not send reminders, create
// activity, or change HubSpot. Read keys from an ignored environment file.
import { createClient } from "@supabase/supabase-js";
import { processCrmProjections } from "../../src/lib/crm/projection.mjs";
import { migrateCrmAssets } from "../../src/lib/crm/assets.mjs";

const mode = process.argv[2];
if (!["index", "files"].includes(mode)) throw new Error("Usage: node workflows.mjs index|files");
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Database configuration is required");
if (mode === "files" && !process.env.HUBSPOT_ACCESS_TOKEN) throw new Error("HubSpot file access is required");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const workers = Number(process.argv.find(value => value.startsWith("--workers="))?.split("=")[1] ?? 1);
if (!Number.isInteger(workers) || workers < 1 || workers > 12) throw new Error("Use 1 to 12 workers");
let paused = false;
await Promise.all(Array.from({ length: workers }, async (_, worker) => {
  while (!paused) {
    const result = mode === "index"
      ? await processCrmProjections(db, { budgetMs: 30000, batchSize: 50 })
      : await migrateCrmAssets(db, process.env.HUBSPOT_ACCESS_TOKEN, { budgetMs: 30000, limit: 10 });
    console.log(JSON.stringify({ worker, ...result }));
    if (mode === "index" ? result.complete : result.paused || !(result.copied + result.blocked + result.failed)) { paused ||= Boolean(result.paused); break; }
  }
}));
